from __future__ import annotations

import ctypes
import hashlib
import logging
import os
import re
import sys
import threading
from dataclasses import dataclass
from typing import Any, Callable

from backend.app.models.session import MidiInputRef

logger = logging.getLogger(__name__)
MidiMessageSink = Callable[[list[int], float | None], bool]


@dataclass(slots=True)
class MidiBackendInfo:
    name: str
    available: bool


class _CoreMidiScheduler:
    _CF_STRING_ENCODING_UTF8 = 0x08000100

    class _MachTimebaseInfo(ctypes.Structure):
        _fields_ = [("numer", ctypes.c_uint32), ("denom", ctypes.c_uint32)]

    def __init__(self) -> None:
        self._corefoundation = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
        self._coremidi = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreMIDI.framework/CoreMIDI")
        self._libsystem = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
        self._configure_signatures()

        timebase = self._MachTimebaseInfo()
        if self._libsystem.mach_timebase_info(ctypes.byref(timebase)) != 0:
            raise RuntimeError("mach_timebase_info failed")
        if timebase.numer == 0 or timebase.denom == 0:
            raise RuntimeError("mach_timebase_info returned an invalid ratio")
        self._timebase = timebase

        self._display_name_key = self._cf_string("displayName")
        self._name_key = self._cf_string("name")
        self._client_name = self._cf_string("VisualCSound MIDI Client")
        self._port_name = self._cf_string("VisualCSound MIDI Output")
        self._endpoint_cache: dict[str, int] = {}

        client = ctypes.c_uint32()
        status = self._coremidi.MIDIClientCreate(self._client_name, None, None, ctypes.byref(client))
        if status != 0:
            raise RuntimeError(f"MIDIClientCreate failed with status {status}")
        self._client = client

        output_port = ctypes.c_uint32()
        status = self._coremidi.MIDIOutputPortCreate(self._client, self._port_name, ctypes.byref(output_port))
        if status != 0:
            raise RuntimeError(f"MIDIOutputPortCreate failed with status {status}")
        self._output_port = output_port

    def __del__(self) -> None:
        self.close()

    def close(self) -> None:
        output_port = getattr(self, "_output_port", None)
        if output_port is not None and int(getattr(output_port, "value", 0)) != 0:
            try:
                self._coremidi.MIDIPortDispose(output_port)
            except Exception:
                pass
            self._output_port = ctypes.c_uint32()

        client = getattr(self, "_client", None)
        if client is not None and int(getattr(client, "value", 0)) != 0:
            try:
                self._coremidi.MIDIClientDispose(client)
            except Exception:
                pass
            self._client = ctypes.c_uint32()

        for attr_name in ("_display_name_key", "_name_key", "_client_name", "_port_name"):
            value = getattr(self, attr_name, None)
            if value:
                try:
                    self._corefoundation.CFRelease(value)
                except Exception:
                    pass
                setattr(self, attr_name, None)

    def send_messages(
        self,
        output_name: str,
        messages: list[list[int]],
        *,
        delivery_delay_seconds: float | None,
    ) -> None:
        endpoint = self._resolve_endpoint(output_name)
        packet_buffer_size = max(1024, 64 * max(1, len(messages)))
        packet_buffer = (ctypes.c_ubyte * packet_buffer_size)()
        packet_list = ctypes.cast(packet_buffer, ctypes.c_void_p)
        packet = self._coremidi.MIDIPacketListInit(packet_list)
        if not packet:
            raise RuntimeError("MIDIPacketListInit failed")

        timestamp = self._timestamp_for_delay(delivery_delay_seconds)
        for message in messages:
            data = (ctypes.c_ubyte * len(message))(*message)
            packet = self._coremidi.MIDIPacketListAdd(
                packet_list,
                packet_buffer_size,
                packet,
                timestamp,
                len(message),
                data,
            )
            if not packet:
                raise RuntimeError("MIDIPacketListAdd failed")

        status = self._coremidi.MIDISend(self._output_port, endpoint, packet_list)
        if status != 0:
            raise RuntimeError(f"MIDISend failed with status {status}")

    def _resolve_endpoint(self, output_name: str) -> int:
        cached = self._endpoint_cache.get(output_name)
        if cached:
            return cached

        count = int(self._coremidi.MIDIGetNumberOfDestinations())
        normalized_target = MidiService._normalize_name(output_name)
        available: list[str] = []
        matched_endpoint: int | None = None

        for index in range(count):
            endpoint = int(self._coremidi.MIDIGetDestination(index))
            if endpoint == 0:
                continue
            endpoint_name = self._endpoint_name(endpoint)
            if endpoint_name:
                available.append(endpoint_name)
            if endpoint_name and MidiService._normalize_name(endpoint_name) == normalized_target:
                matched_endpoint = endpoint
                break

        if matched_endpoint is None:
            available_text = ", ".join(available) if available else "<none>"
            raise ValueError(
                f"No CoreMIDI destination matched '{output_name}'. Available destinations: {available_text}."
            )

        self._endpoint_cache[output_name] = matched_endpoint
        return matched_endpoint

    def _endpoint_name(self, endpoint: int) -> str:
        for key in (self._display_name_key, self._name_key):
            value = ctypes.c_void_p()
            status = self._coremidi.MIDIObjectGetStringProperty(endpoint, key, ctypes.byref(value))
            if status != 0 or not value.value:
                continue
            try:
                text = self._cf_string_to_python(value)
            finally:
                self._corefoundation.CFRelease(value)
            if text:
                return text
        return ""

    def _timestamp_for_delay(self, delivery_delay_seconds: float | None) -> int:
        delay_ns = 0 if delivery_delay_seconds is None else max(0, int(round(delivery_delay_seconds * 1_000_000_000)))
        return int(self._libsystem.mach_absolute_time()) + self._ns_to_host(delay_ns)

    def _ns_to_host(self, nanoseconds: int) -> int:
        return int((int(nanoseconds) * int(self._timebase.denom)) // int(self._timebase.numer))

    def _cf_string(self, value: str) -> ctypes.c_void_p:
        result = self._corefoundation.CFStringCreateWithCString(
            None,
            value.encode("utf-8"),
            self._CF_STRING_ENCODING_UTF8,
        )
        if not result:
            raise RuntimeError(f"Failed to create CFString for '{value}'")
        return ctypes.c_void_p(result)

    def _cf_string_to_python(self, value: ctypes.c_void_p) -> str:
        buffer = ctypes.create_string_buffer(512)
        ok = self._corefoundation.CFStringGetCString(
            value,
            buffer,
            len(buffer),
            self._CF_STRING_ENCODING_UTF8,
        )
        return buffer.value.decode("utf-8") if ok else ""

    def _configure_signatures(self) -> None:
        self._corefoundation.CFStringCreateWithCString.restype = ctypes.c_void_p
        self._corefoundation.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
        self._corefoundation.CFStringGetCString.restype = ctypes.c_bool
        self._corefoundation.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
        self._corefoundation.CFRelease.argtypes = [ctypes.c_void_p]

        self._libsystem.mach_absolute_time.restype = ctypes.c_uint64
        self._libsystem.mach_timebase_info.argtypes = [ctypes.POINTER(self._MachTimebaseInfo)]
        self._libsystem.mach_timebase_info.restype = ctypes.c_int

        self._coremidi.MIDIClientCreate.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
        self._coremidi.MIDIClientCreate.restype = ctypes.c_int32
        self._coremidi.MIDIClientDispose.argtypes = [ctypes.c_uint32]
        self._coremidi.MIDIClientDispose.restype = ctypes.c_int32
        self._coremidi.MIDIOutputPortCreate.argtypes = [ctypes.c_uint32, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
        self._coremidi.MIDIOutputPortCreate.restype = ctypes.c_int32
        self._coremidi.MIDIPortDispose.argtypes = [ctypes.c_uint32]
        self._coremidi.MIDIPortDispose.restype = ctypes.c_int32
        self._coremidi.MIDIGetNumberOfDestinations.restype = ctypes.c_ulong
        self._coremidi.MIDIGetDestination.argtypes = [ctypes.c_ulong]
        self._coremidi.MIDIGetDestination.restype = ctypes.c_uint32
        self._coremidi.MIDIObjectGetStringProperty.argtypes = [ctypes.c_uint32, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
        self._coremidi.MIDIObjectGetStringProperty.restype = ctypes.c_int32
        self._coremidi.MIDIPacketListInit.argtypes = [ctypes.c_void_p]
        self._coremidi.MIDIPacketListInit.restype = ctypes.c_void_p
        self._coremidi.MIDIPacketListAdd.argtypes = [
            ctypes.c_void_p,
            ctypes.c_ulong,
            ctypes.c_void_p,
            ctypes.c_uint64,
            ctypes.c_ushort,
            ctypes.c_void_p,
        ]
        self._coremidi.MIDIPacketListAdd.restype = ctypes.c_void_p
        self._coremidi.MIDISend.argtypes = [ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
        self._coremidi.MIDISend.restype = ctypes.c_int32


class MidiService:
    def __init__(self) -> None:
        self._backend = self._detect_backend()
        self._output_ports: dict[str, Any] = {}
        self._lock = threading.Lock()
        self._warned_missing_output_backend = False
        self._virtual_output_sinks: dict[str, dict[str, MidiMessageSink]] = {}
        self._coremidi_scheduler = self._build_coremidi_scheduler()

    def list_inputs(self) -> list[MidiInputRef]:
        if self._backend.name == "mido":
            try:
                import mido

                names = mido.get_input_names()
                refs = self._build_input_refs(names, backend="mido")
                if refs:
                    return refs
            except Exception:  # pragma: no cover - runtime dependent
                if self._is_expected_linux_alsa_missing():
                    logger.info(
                        "MIDI backend probing skipped: /dev/snd/seq is unavailable in this container; "
                        "using fallback MIDI inputs."
                    )
                else:
                    logger.exception("Failed to query MIDI inputs via mido")
                self._backend = MidiBackendInfo(name="fallback", available=False)

        return self._fallback_inputs()

    def resolve_input(self, selector: str) -> str:
        return self.resolve_input_ref(selector).id

    def resolve_backend_selector(self, selector: str) -> str:
        return self.resolve_input_ref(selector).selector

    def resolve_input_ref(self, selector: str) -> MidiInputRef:
        inputs = self.list_inputs()

        for midi_input in inputs:
            if midi_input.id == selector or midi_input.selector == selector or midi_input.name == selector:
                return midi_input

        raise ValueError(f"MIDI input '{selector}' is unavailable.")

    def send_message(self, input_selector: str, message: list[int]) -> str:
        return self.send_messages(input_selector, [message])

    def send_messages(self, input_selector: str, messages: list[list[int]]) -> str:
        return self.send_scheduled_messages(input_selector, messages, delivery_delay_seconds=None)

    def send_scheduled_message(
        self,
        input_selector: str,
        message: list[int],
        *,
        delivery_delay_seconds: float | None,
    ) -> str:
        return self.send_scheduled_messages(
            input_selector,
            [message],
            delivery_delay_seconds=delivery_delay_seconds,
        )

    def send_scheduled_messages(
        self,
        input_selector: str,
        messages: list[list[int]],
        *,
        delivery_delay_seconds: float | None,
    ) -> str:
        if len(messages) == 0:
            raise ValueError("At least one MIDI message is required")

        normalized_messages: list[list[int]] = []
        for message in messages:
            if len(message) != 3:
                raise ValueError("MIDI message must contain exactly 3 bytes")
            normalized_messages.append([int(value) & 0xFF for value in message])

        input_ref = self.resolve_input_ref(input_selector)

        if self._backend.name != "mido":
            delivered_total = 0
            for message in normalized_messages:
                delivered_total += self._deliver_virtual_output(
                    input_ref.id,
                    message,
                    delivery_delay_seconds=delivery_delay_seconds,
                )
            if delivered_total > 0:
                return f"virtual:{delivered_total}"
            if not self._warned_missing_output_backend:
                logger.warning(
                    "MIDI output backend unavailable; dropping MIDI messages (selector=%s). "
                    "This is expected in Docker-on-macOS without ALSA passthrough.",
                    input_selector,
                )
                self._warned_missing_output_backend = True
            return "mock"

        try:
            import mido

            output_name = self._resolve_output_name(input_ref.id, mido)
            if self._coremidi_scheduler is not None:
                self._coremidi_scheduler.send_messages(
                    output_name,
                    normalized_messages,
                    delivery_delay_seconds=delivery_delay_seconds,
                )
                return output_name
            with self._lock:
                port = self._output_ports.get(output_name)
                if port is None or getattr(port, "closed", False):
                    port = mido.open_output(output_name)
                    self._output_ports[output_name] = port

                for message in normalized_messages:
                    port.send(mido.Message.from_bytes(message))
            return output_name
        except ValueError:
            raise
        except Exception as exc:  # pragma: no cover - runtime dependent
            raise RuntimeError(f"Failed to send MIDI message: {exc}") from exc

    def register_virtual_output_sink(
        self,
        *,
        selector: str,
        sink_id: str,
        sink: MidiMessageSink,
    ) -> None:
        input_ref = self.resolve_input_ref(selector)
        with self._lock:
            sinks = self._virtual_output_sinks.setdefault(input_ref.id, {})
            sinks[sink_id] = sink

    def unregister_virtual_output_sink(self, *, selector: str, sink_id: str) -> None:
        try:
            input_ref = self.resolve_input_ref(selector)
        except ValueError:
            return
        with self._lock:
            sinks = self._virtual_output_sinks.get(input_ref.id)
            if not sinks:
                return
            sinks.pop(sink_id, None)
            if not sinks:
                self._virtual_output_sinks.pop(input_ref.id, None)

    @staticmethod
    def _normalize_name(name: str) -> str:
        normalized = " ".join(name.strip().lower().split())
        # Ignore backend-added numeric suffixes like " 0", " 1"
        normalized = re.sub(r"\s+\d+$", "", normalized)
        return normalized

    @classmethod
    def _build_input_refs(cls, names: list[str], *, backend: str) -> list[MidiInputRef]:
        refs: list[MidiInputRef] = []
        for index, name in enumerate(names):
            refs.append(
                MidiInputRef(
                    id=cls._stable_input_id(backend, name),
                    name=name,
                    backend=backend,
                    selector=str(index),
                )
            )
        return refs

    @staticmethod
    def _stable_input_id(backend: str, name: str) -> str:
        normalized = " ".join(name.strip().lower().split())
        slug = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-") or "device"
        digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]
        return f"{backend}:{slug}:{digest}"

    def _deliver_virtual_output(
        self,
        selector_id: str,
        message: list[int],
        *,
        delivery_delay_seconds: float | None,
    ) -> int:
        with self._lock:
            sinks = list(self._virtual_output_sinks.get(selector_id, {}).values())

        delivered = 0
        for sink in sinks:
            try:
                if sink(message, delivery_delay_seconds):
                    delivered += 1
            except Exception:
                logger.exception("Virtual MIDI sink delivery failed (selector=%s)", selector_id)
        return delivered

    def _resolve_output_name(self, input_selector: str, mido_module: Any) -> str:
        input_ref = self.resolve_input_ref(input_selector)
        output_names = list(mido_module.get_output_names())
        if not output_names:
            raise ValueError(
                "No backend MIDI outputs are available."
            )

        target = self._normalize_name(input_ref.name)

        normalized_outputs = [(name, self._normalize_name(name)) for name in output_names]

        exact = next((name for name, norm in normalized_outputs if norm == target), None)
        if exact:
            return exact

        partial = next(
            (name for name, norm in normalized_outputs if target in norm or norm in target),
            None,
        )
        if partial:
            return partial

        if len(output_names) == 1:
            return output_names[0]

        available = ", ".join(output_names)
        raise ValueError(
            f"No backend MIDI output matched '{input_ref.name}'. "
            f"Available outputs: {available}."
        )

    @staticmethod
    def _detect_backend() -> MidiBackendInfo:
        if MidiService._is_expected_linux_alsa_missing():
            logger.info("Linux ALSA sequencer device (/dev/snd/seq) not present; using fallback MIDI backend")
            return MidiBackendInfo(name="fallback", available=False)
        try:
            import mido  # noqa: F401

            return MidiBackendInfo(name="mido", available=True)
        except Exception:
            return MidiBackendInfo(name="fallback", available=False)

    @staticmethod
    def _is_expected_linux_alsa_missing() -> bool:
        if not sys.platform.startswith("linux"):
            return False
        # Docker Desktop on macOS/Windows runs Linux containers without host ALSA device passthrough by default.
        return not os.path.exists("/dev/snd/seq")

    @staticmethod
    def _fallback_inputs() -> list[MidiInputRef]:
        if sys.platform == "darwin":
            return MidiService._build_input_refs(
                ["IAC Driver Bus 1", "IAC Driver Bus 2"],
                backend="fallback",
            )
        return MidiService._build_input_refs(
            ["Virtual MIDI Input 1", "Virtual MIDI Input 2"],
            backend="fallback",
        )

    @staticmethod
    def _build_coremidi_scheduler() -> _CoreMidiScheduler | None:
        if sys.platform != "darwin":
            return None
        try:
            return _CoreMidiScheduler()
        except Exception:
            logger.exception("Failed to initialize CoreMIDI scheduler; falling back to immediate MIDI sends")
            return None
