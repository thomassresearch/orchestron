from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import os
from pathlib import Path, PurePosixPath
import re
from unittest.mock import patch
import zipfile

from backend.app.models.export import (
    ExportedPatchDefinition,
    PerformanceCsdExportRequest,
    PerformanceExportPayload,
)
from backend.app.models.patch import EngineConfig, PatchDocument, PatchGraph
from backend.app.services.compiler_service import CompilerService, PatchInstrumentTarget
from backend.app.services.gen_asset_service import GenAssetService
from backend.app.services.sequencer_runtime import SessionSequencerRuntime

OFFLINE_RENDER_SR = 48_000
OFFLINE_RENDER_KSMPS = 1
OFFLINE_RENDER_CONTROL_RATE = 48_000
OFFLINE_RENDER_RELEASE_TAIL_SECONDS = 2.0
MIDI_TICKS_PER_QUARTER = 480


@dataclass(slots=True)
class BundledAsset:
    source_path: Path
    archive_path: str


@dataclass(slots=True)
class CapturedMidiEvent:
    time_seconds: float
    message: bytes


class _MidiCaptureService:
    def __init__(self) -> None:
        self.events: list[CapturedMidiEvent] = []

    def send_scheduled_message(
        self,
        _midi_input_selector: str,
        message: list[int],
        *,
        delivery_delay_seconds: float | None = None,
    ) -> str:
        self.events.append(
            CapturedMidiEvent(
                time_seconds=max(0.0, 0.0 if delivery_delay_seconds is None else delivery_delay_seconds),
                message=bytes(int(value) & 0xFF for value in message),
            )
        )
        return "offline-export"

    def send_scheduled_messages(
        self,
        _midi_input_selector: str,
        messages: list[list[int]],
        *,
        delivery_delay_seconds: float | None = None,
    ) -> str:
        for message in messages:
            self.send_scheduled_message(
                _midi_input_selector,
                message,
                delivery_delay_seconds=delivery_delay_seconds,
            )
        return "offline-export"


class PerformanceExportService:
    def __init__(
        self,
        compiler_service: CompilerService,
        gen_asset_service: GenAssetService,
    ) -> None:
        self._compiler_service = compiler_service
        self._gen_asset_service = gen_asset_service

    def build_performance_csd_archive(self, request: PerformanceCsdExportRequest) -> bytes:
        base_name = self._sanitize_file_base_name(request.performance_export.performance.name)
        bundle_root = PurePosixPath(base_name)
        midi_file_name = f"{base_name}.mid"
        csd_file_name = f"{base_name}.csd"
        output_wave_name = f"{base_name}.wav"

        patch_definitions, bundled_assets = self._rewrite_patch_definitions_for_export(
            request.performance_export.patch_definitions
        )
        targets = self._build_compile_targets(
            performance_export=request.performance_export,
            patch_definitions=patch_definitions,
        )

        compile_artifact = self._compiler_service.compile_patch_bundle(
            targets=targets,
            midi_input="0",
            rtmidi_module="virtual",
        )

        playback_duration_seconds = self._playback_duration_seconds(request)
        csd = self._build_offline_csd(
            orc=self._rewrite_orc_for_offline_render(compile_artifact.orc),
            midi_file_name=midi_file_name,
            output_wave_name=output_wave_name,
            duration_seconds=playback_duration_seconds + OFFLINE_RENDER_RELEASE_TAIL_SECONDS,
        )
        midi_bytes = self._build_midi_file(
            request=request,
            controller_default_channels=tuple(
                sorted({target.midi_channel for target in targets if 1 <= target.midi_channel <= 16})
            )
            or (1,),
            track_name=base_name,
        )
        readme = self._build_readme(
            bundle_directory_name=base_name,
            csd_file_name=csd_file_name,
            midi_file_name=midi_file_name,
            output_wave_name=output_wave_name,
        )

        archive_buffer = BytesIO()
        with zipfile.ZipFile(archive_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(str(bundle_root / csd_file_name), csd.encode("utf-8"))
            archive.writestr(str(bundle_root / midi_file_name), midi_bytes)
            archive.writestr(str(bundle_root / "README.txt"), readme.encode("utf-8"))
            for asset in bundled_assets:
                archive.writestr(str(bundle_root / asset.archive_path), asset.source_path.read_bytes())

        return archive_buffer.getvalue()

    def _rewrite_patch_definitions_for_export(
        self,
        patch_definitions: list[ExportedPatchDefinition],
    ) -> tuple[list[ExportedPatchDefinition], list[BundledAsset]]:
        rewritten: list[ExportedPatchDefinition] = []
        bundle_index = _AssetBundleIndex(self._gen_asset_service)
        for definition in patch_definitions:
            graph = definition.graph.model_copy(deep=True)
            graph.engine_config = self._offline_engine_config(graph.engine_config)
            self._rewrite_graph_asset_paths(graph, bundle_index)
            rewritten.append(
                definition.model_copy(
                    update={"graph": graph},
                    deep=True,
                )
            )
        return rewritten, bundle_index.assets

    def _build_compile_targets(
        self,
        *,
        performance_export: PerformanceExportPayload,
        patch_definitions: list[ExportedPatchDefinition],
    ) -> list[PatchInstrumentTarget]:
        definition_by_id = {definition.source_patch_id: definition for definition in patch_definitions}
        targets: list[PatchInstrumentTarget] = []
        for instrument in performance_export.performance.config.instruments:
            definition = definition_by_id.get(instrument.patch_id)
            if definition is None:
                raise ValueError(
                    f"Performance instrument references missing patch definition '{instrument.patch_id}'."
                )
            targets.append(
                PatchInstrumentTarget(
                    patch=PatchDocument(
                        id=definition.source_patch_id,
                        name=definition.name,
                        description=definition.description,
                        schema_version=definition.schema_version,
                        graph=definition.graph.model_copy(deep=True),
                    ),
                    midi_channel=instrument.midi_channel,
                )
            )

        if not targets:
            raise ValueError("Performance export must include at least one assigned instrument.")

        return targets

    def _rewrite_graph_asset_paths(self, graph: PatchGraph, bundle_index: "_AssetBundleIndex") -> None:
        ui_layout = graph.ui_layout
        if not isinstance(ui_layout, dict):
            return

        gen_nodes = ui_layout.get("gen_nodes")
        if isinstance(gen_nodes, dict):
            for node_id, raw_node_config in list(gen_nodes.items()):
                if not isinstance(raw_node_config, dict):
                    continue
                updated = dict(raw_node_config)
                archive_path = self._resolve_bundled_archive_path(updated, bundle_index)
                if archive_path is None:
                    continue
                updated["samplePath"] = archive_path
                updated.pop("sampleAsset", None)
                gen_nodes[node_id] = updated

        sfload_nodes = ui_layout.get("sfload_nodes")
        if isinstance(sfload_nodes, dict):
            for node_id, raw_node_config in list(sfload_nodes.items()):
                if not isinstance(raw_node_config, dict):
                    continue
                updated = dict(raw_node_config)
                archive_path = self._resolve_bundled_archive_path(updated, bundle_index)
                if archive_path is None:
                    continue
                updated["samplePath"] = archive_path
                updated.pop("sampleAsset", None)
                sfload_nodes[node_id] = updated

    def _resolve_bundled_archive_path(
        self,
        raw_node_config: dict[str, object],
        bundle_index: "_AssetBundleIndex",
    ) -> str | None:
        sample_asset = raw_node_config.get("sampleAsset")
        if isinstance(sample_asset, dict):
            stored_name = sample_asset.get("stored_name")
            if isinstance(stored_name, str) and stored_name.strip():
                return bundle_index.add_stored_asset(stored_name.strip()).archive_path

        sample_path = raw_node_config.get("samplePath")
        if isinstance(sample_path, str) and sample_path.strip():
            return bundle_index.add_path_asset(sample_path.strip()).archive_path

        return None

    @staticmethod
    def _offline_engine_config(engine_config: EngineConfig) -> EngineConfig:
        payload = engine_config.model_dump(by_alias=True)
        payload.update(
            {
                "sr": OFFLINE_RENDER_SR,
                "control_rate": OFFLINE_RENDER_CONTROL_RATE,
                "ksmps": OFFLINE_RENDER_KSMPS,
            }
        )
        return EngineConfig.model_validate(payload)

    @staticmethod
    def _rewrite_orc_for_offline_render(orc: str) -> str:
        rewritten = re.sub(r"^sr\s*=\s*\d+\s*$", f"sr = {OFFLINE_RENDER_SR}", orc, count=1, flags=re.MULTILINE)
        rewritten = re.sub(
            r"^ksmps\s*=\s*\d+\s*$",
            f"ksmps = {OFFLINE_RENDER_KSMPS}",
            rewritten,
            count=1,
            flags=re.MULTILINE,
        )
        return rewritten

    @staticmethod
    def _build_offline_csd(
        *,
        orc: str,
        midi_file_name: str,
        output_wave_name: str,
        duration_seconds: float,
    ) -> str:
        return "\n".join(
            [
                "<CsoundSynthesizer>",
                "<CsOptions>",
                f"-d -W -o {output_wave_name} -F {midi_file_name}",
                "</CsOptions>",
                "<CsInstruments>",
                orc,
                "</CsInstruments>",
                "<CsScore>",
                "f 1 0 16384 10 1",
                f"f 0 {PerformanceExportService._format_duration(duration_seconds)}",
                "</CsScore>",
                "</CsoundSynthesizer>",
            ]
        )

    def _build_midi_file(
        self,
        *,
        request: PerformanceCsdExportRequest,
        controller_default_channels: tuple[int, ...],
        track_name: str,
    ) -> bytes:
        capture = _MidiCaptureService()
        runtime = SessionSequencerRuntime(
            session_id="performance-export",
            midi_service=capture,  # type: ignore[arg-type]
            midi_input_selector="offline-export",
            controller_default_channels=controller_default_channels,
            publish_event=lambda _event_type, _payload: None,
        )
        runtime.configure(request.sequencer_config)

        scheduled_time = 0.0
        with runtime._lock:
            runtime._running = True

        with patch("backend.app.services.sequencer_runtime.time.perf_counter", return_value=0.0):
            while True:
                with runtime._lock:
                    if not runtime._running:
                        break
                    config = runtime._config
                    current_subunit = runtime._absolute_subunit
                if config is None:
                    break
                scheduled_time += runtime._perform_subunit_event(
                    config,
                    current_subunit,
                    scheduled_time=scheduled_time,
                )

        with runtime._lock:
            config = runtime._config
            if config is not None:
                for track_id, active_notes in runtime._active_notes.items():
                    if not active_notes:
                        continue
                    track = config.tracks.get(track_id)
                    if track is None:
                        continue
                    for note in sorted(active_notes):
                        capture.events.append(
                            CapturedMidiEvent(
                                time_seconds=scheduled_time,
                                message=bytes(runtime._note_off_message(track.midi_channel, note)),
                            )
                        )

        return self._encode_midi_file(
            tempo_bpm=request.sequencer_config.timing.tempo_bpm,
            track_name=track_name,
            events=capture.events,
        )

    @staticmethod
    def _encode_midi_file(
        *,
        tempo_bpm: int,
        track_name: str,
        events: list[CapturedMidiEvent],
    ) -> bytes:
        tempo_microseconds = max(1, round(60_000_000 / max(1, tempo_bpm)))
        header = (
            b"MThd"
            + (6).to_bytes(4, byteorder="big")
            + (1).to_bytes(2, byteorder="big")
            + (2).to_bytes(2, byteorder="big")
            + MIDI_TICKS_PER_QUARTER.to_bytes(2, byteorder="big")
        )

        tempo_track = PerformanceExportService._encode_track(
            [
                (0, PerformanceExportService._track_name_meta(f"{track_name} tempo")),
                (0, b"\xFF\x51\x03" + tempo_microseconds.to_bytes(3, byteorder="big")),
            ]
        )

        midi_events: list[tuple[int, bytes]] = []
        for event in events:
            tick = max(
                0,
                round((event.time_seconds * max(1, tempo_bpm) * MIDI_TICKS_PER_QUARTER) / 60.0),
            )
            midi_events.append((tick, event.message))

        midi_events.sort(key=lambda item: (item[0], PerformanceExportService._message_priority(item[1]), item[1]))
        performance_track = PerformanceExportService._encode_track(
            [(0, PerformanceExportService._track_name_meta(track_name)), *midi_events]
        )
        return header + tempo_track + performance_track

    @staticmethod
    def _encode_track(events: list[tuple[int, bytes]]) -> bytes:
        data = bytearray()
        last_tick = 0
        for tick, payload in events:
            delta = max(0, int(tick) - last_tick)
            data.extend(PerformanceExportService._encode_variable_length(delta))
            data.extend(payload)
            last_tick = max(last_tick, int(tick))
        data.extend(b"\x00\xFF\x2F\x00")
        return b"MTrk" + len(data).to_bytes(4, byteorder="big") + bytes(data)

    @staticmethod
    def _encode_variable_length(value: int) -> bytes:
        remaining = max(0, int(value))
        buffer = [remaining & 0x7F]
        remaining >>= 7
        while remaining > 0:
            buffer.insert(0, (remaining & 0x7F) | 0x80)
            remaining >>= 7
        return bytes(buffer)

    @staticmethod
    def _track_name_meta(value: str) -> bytes:
        encoded = value.encode("utf-8")
        return b"\xFF\x03" + PerformanceExportService._encode_variable_length(len(encoded)) + encoded

    @staticmethod
    def _message_priority(message: bytes) -> int:
        if not message:
            return 4
        status = message[0] & 0xF0
        if status == 0x80:
            return 0
        if status == 0xB0 and len(message) >= 2 and message[1] in {120, 123}:
            return 1
        if status == 0x90:
            return 2
        if status == 0xB0:
            return 3
        return 4

    @staticmethod
    def _playback_duration_seconds(request: PerformanceCsdExportRequest) -> float:
        transport_steps = max(
            1,
            request.sequencer_config.playback_end_step - request.sequencer_config.playback_start_step,
        )
        beat_duration = 60.0 / float(max(1, request.sequencer_config.timing.tempo_bpm))
        return (transport_steps / 8.0) * beat_duration

    @staticmethod
    def _build_readme(
        *,
        bundle_directory_name: str,
        csd_file_name: str,
        midi_file_name: str,
        output_wave_name: str,
    ) -> str:
        return "\n".join(
            [
                "Orchestron offline render export",
                "",
                "Contents:",
                f"- {csd_file_name}: compiled offline-render Csound document",
                f"- {midi_file_name}: multitrack arranger playback from beginning to arrangement end",
                "- assets/: referenced sample audio and SoundFont files bundled for the CSD",
                "",
                "Render steps:",
                f"1. Extract the ZIP and change into the bundled '{bundle_directory_name}/' directory.",
                "2. Render with Csound using the bundled MIDI file.",
                "",
                "Exact command line:",
                f"csound -d -W -o {output_wave_name} -F {midi_file_name} {csd_file_name}",
                "",
                "Equivalent short form (uses the embedded CsOptions in the CSD):",
                f"csound {csd_file_name}",
                "",
                "If you need a longer release tail, increase the final 'f 0 ...' duration line in the CSD.",
                "",
            ]
        )

    @staticmethod
    def _format_duration(value: float) -> str:
        return f"{max(0.01, value):.6f}".rstrip("0").rstrip(".")

    @staticmethod
    def _sanitize_file_base_name(value: str) -> str:
        candidate = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
        candidate = candidate.strip("._-")
        return candidate or "performance"


class _AssetBundleIndex:
    def __init__(self, gen_asset_service: GenAssetService) -> None:
        self._gen_asset_service = gen_asset_service
        self.assets: list[BundledAsset] = []
        self._archive_path_by_source: dict[str, BundledAsset] = {}
        self._used_archive_paths: set[str] = set()

    def add_stored_asset(self, stored_name: str) -> BundledAsset:
        source_path = self._gen_asset_service.resolve_audio_path(stored_name)
        source_key = str(source_path.resolve())
        existing = self._archive_path_by_source.get(source_key)
        if existing is not None:
            return existing
        archive_path = PurePosixPath("assets") / stored_name
        bundled = BundledAsset(source_path=source_path, archive_path=str(archive_path))
        self._archive_path_by_source[source_key] = bundled
        self.assets.append(bundled)
        self._used_archive_paths.add(str(archive_path))
        return bundled

    def add_path_asset(self, sample_path: str) -> BundledAsset:
        source_path = self._resolve_sample_path(sample_path)
        source_key = str(source_path.resolve())
        existing = self._archive_path_by_source.get(source_key)
        if existing is not None:
            return existing

        archive_path = self._unique_archive_path(source_path.name)
        bundled = BundledAsset(source_path=source_path, archive_path=archive_path)
        self._archive_path_by_source[source_key] = bundled
        self.assets.append(bundled)
        return bundled

    def _resolve_sample_path(self, sample_path: str) -> Path:
        expanded = Path(sample_path).expanduser()
        candidate = expanded if expanded.is_absolute() else (Path.cwd() / expanded)
        resolved = candidate.resolve()
        if not resolved.exists():
            raise ValueError(f"Referenced sample file '{sample_path}' does not exist on the backend.")
        if not resolved.is_file():
            raise ValueError(f"Referenced sample path '{sample_path}' is not a file.")
        return resolved

    def _unique_archive_path(self, filename: str) -> str:
        basename = self._sanitize_filename(filename)
        stem, suffix = os.path.splitext(basename)
        candidate = str(PurePosixPath("assets") / basename)
        index = 2
        while candidate in self._used_archive_paths:
            next_name = f"{stem}_{index}{suffix}"
            candidate = str(PurePosixPath("assets") / next_name)
            index += 1
        self._used_archive_paths.add(candidate)
        return candidate

    @staticmethod
    def _sanitize_filename(filename: str) -> str:
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(filename).name)
        safe = safe.strip("._")
        return safe or "asset.bin"
