from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path, PurePosixPath
import re
from time import perf_counter as _monotonic_seconds
from unittest.mock import patch
import zipfile

from backend.app.models.export import (
    ExportedPatchDefinition,
    OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS,
    OFFLINE_CSD_EXPORT_MAX_WALL_SECONDS,
    PerformanceCsdExportRequest,
    PerformanceExportPayload,
)
from backend.app.models.patch import EngineConfig, PatchDocument, PatchGraph
from backend.app.services.compiler_service import CompilerService, PatchInstrumentTarget
from backend.app.services.compiler_orchestra import OrchestraEmitter
from backend.app.services.gen_asset_service import GenAssetService
from backend.app.services.arpeggiator_runtime import PerformanceMidiRouter
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


@dataclass(slots=True)
class ScoreNoteEvent:
    instrument_ref: str
    start_seconds: float
    duration_seconds: float
    midi_channel: int
    note: int
    velocity: int


@dataclass(slots=True)
class ScoreControllerEvent:
    time_seconds: float
    midi_channel: int
    controller_number: int
    value: int


class OfflineMidiExportBudgetExceededError(ValueError):
    pass


class OfflineMidiExportTimeoutError(ValueError):
    pass


class OfflineMidiExportNoNoteEventsError(ValueError):
    pass


class _MidiCaptureService:
    def __init__(self, *, max_events: int) -> None:
        self._max_events = max(1, int(max_events))
        self.events: list[CapturedMidiEvent] = []
        self.current_time_seconds = 0.0
        self.current_sample = 0
        self.event_budget_exceeded = False

    def _append_event(self, *, time_seconds: float, message: list[int]) -> None:
        if len(self.events) >= self._max_events:
            self.event_budget_exceeded = True
            return
        self.events.append(
            CapturedMidiEvent(
                time_seconds=max(0.0, float(time_seconds)),
                message=bytes(int(value) & 0xFF for value in message),
            )
        )

    def raise_if_event_budget_exceeded(self) -> None:
        if self.event_budget_exceeded or len(self.events) > self._max_events:
            raise OfflineMidiExportBudgetExceededError(
                "Offline performance CSD export generated too many MIDI events "
                f"(limit {self._max_events})."
            )

    def send_scheduled_message(
        self,
        _midi_input_selector: str,
        message: list[int],
        *,
        delivery_delay_seconds: float | None = None,
    ) -> str:
        self._append_event(
            time_seconds=0.0 if delivery_delay_seconds is None else delivery_delay_seconds,
            message=message,
        )
        return "offline-export"

    def enqueue_timestamped_midi(
        self,
        message: list[int],
        *,
        source: str,
        target_engine_sample: int | None = None,
        delivery_delay_seconds: float | None = None,
        source_timestamp_ns: int | None = None,
        mapped_backend_monotonic_ns: int | None = None,
        sync_stale: bool = False,
    ) -> bool:
        _ = (source, source_timestamp_ns, mapped_backend_monotonic_ns, sync_stale)
        if target_engine_sample is not None:
            event_time = max(0.0, int(target_engine_sample) / float(OFFLINE_RENDER_SR))
        else:
            event_time = self.current_time_seconds + max(0.0, float(delivery_delay_seconds or 0.0))
        self._append_event(time_seconds=event_time, message=message)
        return not self.event_budget_exceeded

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
            allow_packaged_asset_paths=True,
            performance_input_mode="score" if request.event_source == "score" else "midi",
        )

        playback_duration_seconds = self._playback_duration_seconds(request)
        captured_events = self._capture_offline_midi_events(
            request=request,
            controller_default_channels=tuple(
                sorted({target.midi_channel for target in targets if 1 <= target.midi_channel <= 16})
            )
            or (1,),
        )
        self._raise_if_no_note_on_events(captured_events)

        warnings = list(compile_artifact.diagnostics)
        if request.event_source == "score":
            score_lines, score_warnings = self._build_score_lines(
                events=captured_events,
                targets=targets,
                duration_seconds=playback_duration_seconds + OFFLINE_RENDER_RELEASE_TAIL_SECONDS,
            )
            warnings.extend(score_warnings)
            csd = self._build_offline_score_csd(
                orc=self._rewrite_orc_for_offline_render(compile_artifact.orc),
                output_wave_name=output_wave_name,
                score_lines=score_lines,
            )
            readme = self._build_score_readme(
                bundle_directory_name=base_name,
                csd_file_name=csd_file_name,
                output_wave_name=output_wave_name,
                warnings=warnings,
            )
            midi_bytes = None
        else:
            csd = self._build_offline_midi_csd(
                orc=self._rewrite_orc_for_offline_render(compile_artifact.orc),
                midi_file_name=midi_file_name,
                output_wave_name=output_wave_name,
                duration_seconds=playback_duration_seconds + OFFLINE_RENDER_RELEASE_TAIL_SECONDS,
            )
            midi_bytes = self._encode_midi_file(
                tempo_bpm=request.sequencer_config.timing.tempo_bpm,
                track_name=base_name,
                events=captured_events,
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
            if midi_bytes is not None:
                archive.writestr(str(bundle_root / midi_file_name), midi_bytes)
            archive.writestr(str(bundle_root / "README.txt"), readme.encode("utf-8"))
            if warnings:
                archive.writestr(str(bundle_root / "WARNINGS.txt"), "\n".join(warnings).encode("utf-8"))
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
            if definition.is_template:
                raise ValueError(
                    f"Patch definition '{definition.name}' is a template and cannot be exported as a performance instrument."
                )
            targets.append(
                PatchInstrumentTarget(
                    patch=PatchDocument(
                        id=definition.source_patch_id,
                        name=definition.name,
                        description=definition.description,
                        is_template=definition.is_template,
                        always_on=definition.always_on,
                        schema_version=definition.schema_version,
                        graph=definition.graph.model_copy(deep=True),
                    ),
                    midi_channel=0 if definition.always_on else instrument.midi_channel,
                    assignment_id=instrument.id,
                    always_on=definition.always_on,
                    effect_source_ids=tuple(instrument.effect_source_ids if definition.always_on else []),
                    effect_routes=tuple(
                        (route.source_id, route.channel) for route in instrument.effect_routes if definition.always_on
                    ),
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
                archive_path = self._resolve_bundled_archive_path(
                    updated,
                    bundle_index,
                    raw_path_error=(
                        f"GEN node '{node_id}' uses samplePath. Upload the audio file before exporting a performance CSD."
                    )
                    if self._is_gen01_node_config(updated)
                    else None,
                )
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
                archive_path = self._resolve_bundled_archive_path(
                    updated,
                    bundle_index,
                    raw_path_error=(
                        f"sfload node '{node_id}' uses samplePath. Upload the SoundFont file before exporting a performance CSD."
                    ),
                )
                if archive_path is None:
                    continue
                updated["samplePath"] = archive_path
                updated.pop("sampleAsset", None)
                sfload_nodes[node_id] = updated

        for node in graph.nodes:
            if node.opcode != "sfload":
                continue
            raw_config = sfload_nodes.get(node.id) if isinstance(sfload_nodes, dict) else None
            if isinstance(raw_config, dict) and self._has_exportable_sample_reference(raw_config):
                continue
            raw_filename = node.params.get("filename")
            if isinstance(raw_filename, str) and raw_filename.strip():
                raise ValueError(
                    f"sfload node '{node.id}' uses a raw filename parameter. "
                    "Upload the SoundFont file before exporting a performance CSD."
                )

    def _resolve_bundled_archive_path(
        self,
        raw_node_config: dict[str, object],
        bundle_index: "_AssetBundleIndex",
        *,
        raw_path_error: str | None,
    ) -> str | None:
        sample_asset = raw_node_config.get("sampleAsset")
        if isinstance(sample_asset, dict):
            stored_name = sample_asset.get("stored_name")
            if isinstance(stored_name, str) and stored_name.strip():
                return bundle_index.add_stored_asset(stored_name.strip()).archive_path

        sample_path = raw_node_config.get("samplePath")
        if isinstance(sample_path, str) and sample_path.strip():
            if raw_path_error is not None:
                raise ValueError(raw_path_error)

        return None

    @staticmethod
    def _has_exportable_sample_reference(raw_node_config: dict[str, object]) -> bool:
        sample_asset = raw_node_config.get("sampleAsset")
        if isinstance(sample_asset, dict):
            stored_name = sample_asset.get("stored_name")
            if isinstance(stored_name, str) and stored_name.strip():
                return True
        sample_path = raw_node_config.get("samplePath")
        return isinstance(sample_path, str) and sample_path.strip().startswith("assets/")

    @staticmethod
    def _is_gen01_node_config(raw_node_config: dict[str, object]) -> bool:
        routine_name = raw_node_config.get("routineName")
        if isinstance(routine_name, str):
            normalized = routine_name.strip().lower()
            if normalized:
                return normalized in {"1", "gen1", "gen01"}

        routine_number = raw_node_config.get("routineNumber")
        if isinstance(routine_number, bool):
            return int(routine_number) == 1
        if isinstance(routine_number, int | float):
            return abs(round(routine_number)) == 1
        if isinstance(routine_number, str):
            try:
                return abs(round(float(routine_number.strip()))) == 1
            except ValueError:
                return False
        return False

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
    def _build_offline_midi_csd(
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
                f"-d -W -f -o {output_wave_name} -F {midi_file_name}",
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

    @staticmethod
    def _build_offline_score_csd(
        *,
        orc: str,
        output_wave_name: str,
        score_lines: list[str],
    ) -> str:
        return "\n".join(
            [
                "<CsoundSynthesizer>",
                "<CsOptions>",
                f"-d -W -f -o {output_wave_name}",
                "</CsOptions>",
                "<CsInstruments>",
                orc,
                "</CsInstruments>",
                "<CsScore>",
                *score_lines,
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
        captured_events = self._capture_offline_midi_events(
            request=request,
            controller_default_channels=controller_default_channels,
        )
        self._raise_if_no_note_on_events(captured_events)
        return self._encode_midi_file(
            tempo_bpm=request.sequencer_config.timing.tempo_bpm,
            track_name=track_name,
            events=captured_events,
        )

    def _capture_offline_midi_events(
        self,
        *,
        request: PerformanceCsdExportRequest,
        controller_default_channels: tuple[int, ...],
    ) -> list[CapturedMidiEvent]:
        capture = _MidiCaptureService(max_events=OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS)
        router = PerformanceMidiRouter(
            enqueue_timestamped_midi=capture.enqueue_timestamped_midi,
            current_engine_sample=lambda: capture.current_sample,
            output_name="offline-export",
        )
        runtime = SessionSequencerRuntime(
            session_id="performance-export",
            midi_service=router,  # type: ignore[arg-type]
            midi_input_selector="offline-export",
            controller_default_channels=controller_default_channels,
            publish_event=lambda _event_type, _payload: None,
        )
        runtime.configure(request.sequencer_config)
        router.configure(
            request.sequencer_config.arpeggiators,
            tempo_bpm=request.sequencer_config.timing.tempo_bpm,
        )

        scheduled_time = 0.0
        deadline = _monotonic_seconds() + OFFLINE_CSD_EXPORT_MAX_WALL_SECONDS
        with runtime._lock:
            runtime._running = True

        try:
            with patch(
                "backend.app.services.sequencer_runtime.time.perf_counter",
                side_effect=lambda: capture.current_time_seconds,
            ):
                while True:
                    if _monotonic_seconds() > deadline:
                        raise OfflineMidiExportTimeoutError(
                            "Offline performance CSD export MIDI generation exceeded "
                            f"{OFFLINE_CSD_EXPORT_MAX_WALL_SECONDS:.1f} seconds."
                        )
                    with runtime._lock:
                        if not runtime._running:
                            break
                        config = runtime._config
                        current_subunit = runtime._absolute_subunit
                    if config is None:
                        break
                    capture.current_time_seconds = scheduled_time
                    capture.current_sample = int(round(scheduled_time * OFFLINE_RENDER_SR))
                    block_start_sample = capture.current_sample
                    scheduled_time += runtime._perform_subunit_event(
                        config,
                        current_subunit,
                        scheduled_time=scheduled_time,
                    )
                    capture.current_time_seconds = scheduled_time
                    capture.current_sample = int(round(scheduled_time * OFFLINE_RENDER_SR))
                    router.advance_render_block(
                        block_start_sample=block_start_sample,
                        block_end_sample=max(block_start_sample + 1, capture.current_sample),
                        sample_rate=OFFLINE_RENDER_SR,
                        tempo_bpm=request.sequencer_config.timing.tempo_bpm,
                    )
                    capture.raise_if_event_budget_exceeded()
        finally:
            router.shutdown()
        capture.raise_if_event_budget_exceeded()

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
                        capture._append_event(
                            time_seconds=scheduled_time,
                            message=runtime._note_off_message(track.midi_channel, note),
                        )
                        capture.raise_if_event_budget_exceeded()

        return capture.events

    def _raise_if_no_note_on_events(self, events: list[CapturedMidiEvent]) -> None:
        if not self._has_note_on_events(events):
            raise OfflineMidiExportNoNoteEventsError(
                "Offline performance CSD export generated no MIDI note-on events. "
                "Enable at least one sequencer or arranger track before exporting."
            )

    def _build_score_lines(
        self,
        *,
        events: list[CapturedMidiEvent],
        targets: list[PatchInstrumentTarget],
        duration_seconds: float,
    ) -> tuple[list[str], list[str]]:
        warnings: list[str] = []
        note_events = self._score_note_events(events, targets=targets, warnings=warnings)
        if not note_events:
            raise OfflineMidiExportNoNoteEventsError(
                "Offline performance CSD score export generated no playable score note events. "
                "Enable at least one sequencer or arranger track targeting an assigned instrument."
            )

        controller_events = self._score_controller_events(events)
        setter_duration = 1.0 / float(OFFLINE_RENDER_SR)
        lines = ["f 1 0 16384 10 1"]

        for event in controller_events:
            index = OrchestraEmitter.score_controller_index(event.midi_channel, event.controller_number)
            lines.append(
                "i "
                f"{self._format_score_instrument_ref(OrchestraEmitter.score_controller_instrument_ref())} "
                f"{self._format_score_number(event.time_seconds)} "
                f"{self._format_score_number(setter_duration)} "
                f"{index} {event.value}"
            )

        for event in note_events:
            lines.append(
                "i "
                f"{self._format_score_instrument_ref(event.instrument_ref)} "
                f"{self._format_score_number(event.start_seconds)} "
                f"{self._format_score_number(event.duration_seconds)} "
                f"{event.note} {event.velocity}"
            )

        lines.append(f"f 0 {self._format_duration(duration_seconds)}")
        return lines, warnings

    def _score_note_events(
        self,
        events: list[CapturedMidiEvent],
        *,
        targets: list[PatchInstrumentTarget],
        warnings: list[str],
    ) -> list[ScoreNoteEvent]:
        channel_to_instrument_ref = self._score_instrument_ref_by_channel(targets)
        open_notes: dict[tuple[int, int], list[tuple[float, int]]] = {}
        score_events: list[ScoreNoteEvent] = []
        skipped_channels: set[int] = set()
        end_time = max((event.time_seconds for event in events), default=0.0)

        def close_note(channel: int, note: int, time_seconds: float) -> None:
            queue = open_notes.get((channel, note))
            if not queue:
                return
            start_seconds, velocity = queue.pop(0)
            if not queue:
                open_notes.pop((channel, note), None)
            instrument_ref = channel_to_instrument_ref.get(channel)
            if instrument_ref is None:
                skipped_channels.add(channel)
                return
            score_events.append(
                ScoreNoteEvent(
                    instrument_ref=instrument_ref,
                    start_seconds=start_seconds,
                    duration_seconds=max(1.0 / float(OFFLINE_RENDER_SR), time_seconds - start_seconds),
                    midi_channel=channel,
                    note=note,
                    velocity=velocity,
                )
            )

        def close_channel_notes(channel: int, time_seconds: float) -> None:
            channel_keys = sorted(key for key in open_notes if key[0] == channel)
            for _channel, note in channel_keys:
                while open_notes.get((channel, note)):
                    close_note(channel, note, time_seconds)

        for event in sorted(events, key=lambda item: (item.time_seconds, self._message_priority(item.message))):
            message = event.message
            if len(message) < 3:
                continue
            status = message[0] & 0xF0
            channel = (message[0] & 0x0F) + 1
            data_1 = int(message[1])
            data_2 = int(message[2])
            if status == 0x90 and data_2 > 0:
                open_notes.setdefault((channel, data_1), []).append((event.time_seconds, data_2))
            elif status in {0x80, 0x90}:
                close_note(channel, data_1, event.time_seconds)
            elif status == 0xB0 and data_1 in {120, 123}:
                close_channel_notes(channel, event.time_seconds)

        for channel, note in sorted(list(open_notes)):
            while open_notes.get((channel, note)):
                close_note(channel, note, end_time)

        if skipped_channels:
            warnings.append(
                "Score CSD export skipped note events on unassigned MIDI channel(s): "
                + ", ".join(str(channel) for channel in sorted(skipped_channels))
                + "."
            )
        return sorted(
            score_events,
            key=lambda item: (
                item.start_seconds,
                self._format_score_instrument_ref(item.instrument_ref),
                item.note,
                item.velocity,
            ),
        )

    @staticmethod
    def _score_controller_events(events: list[CapturedMidiEvent]) -> list[ScoreControllerEvent]:
        controller_events: list[ScoreControllerEvent] = []
        for event in events:
            message = event.message
            if len(message) < 3 or (message[0] & 0xF0) != 0xB0:
                continue
            controller_number = int(message[1])
            if controller_number in {120, 123}:
                continue
            controller_events.append(
                ScoreControllerEvent(
                    time_seconds=event.time_seconds,
                    midi_channel=(message[0] & 0x0F) + 1,
                    controller_number=controller_number,
                    value=int(message[2]),
                )
            )
        return sorted(
            controller_events,
            key=lambda item: (item.time_seconds, item.midi_channel, item.controller_number, item.value),
        )

    @staticmethod
    def _score_instrument_ref_by_channel(targets: list[PatchInstrumentTarget]) -> dict[int, str]:
        mapping: dict[int, str] = {}
        for instrument_number, target in enumerate(targets, start=1):
            if target.midi_channel <= 0:
                continue
            # Named instruments are still assigned stable numeric ids by Csound in
            # declaration order; numeric score events are compatible with older
            # Csound versions that reject quoted instrument names in CsScore.
            mapping[target.midi_channel] = str(instrument_number)
        return mapping

    @staticmethod
    def _format_score_instrument_ref(value: str) -> str:
        if re.fullmatch(r"\d+", value):
            return value
        return OrchestraEmitter._format_csound_string(value)

    @staticmethod
    def _has_note_on_events(events: list[CapturedMidiEvent]) -> bool:
        return any(
            len(event.message) >= 3
            and (event.message[0] & 0xF0) == 0x90
            and event.message[2] > 0
            for event in events
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
                f"csound -d -W -f -o {output_wave_name} -F {midi_file_name} {csd_file_name}",
                "",
                "Equivalent short form (uses the embedded CsOptions in the CSD):",
                f"csound {csd_file_name}",
                "",
                "The WAV is written as 32-bit float to preserve the same headroom as live browser-clock audio.",
                "",
                "If you need a longer release tail, increase the final 'f 0 ...' duration line in the CSD.",
                "",
            ]
        )

    @staticmethod
    def _build_score_readme(
        *,
        bundle_directory_name: str,
        csd_file_name: str,
        output_wave_name: str,
        warnings: list[str],
    ) -> str:
        lines = [
            "Orchestron offline score render export",
            "",
            "Contents:",
            f"- {csd_file_name}: compiled offline-render Csound document with inline score events",
            "- assets/: referenced sample audio and SoundFont files bundled for the CSD",
        ]
        if warnings:
            lines.append("- WARNINGS.txt: export-time approximations or skipped events")
        lines.extend(
            [
                "",
                "Render steps:",
                f"1. Extract the ZIP and change into the bundled '{bundle_directory_name}/' directory.",
                "2. Render with Csound using the inline score embedded in the CSD.",
                "",
                "Exact command line:",
                f"csound -d -W -f -o {output_wave_name} {csd_file_name}",
                "",
                "Equivalent short form (uses the embedded CsOptions in the CSD):",
                f"csound {csd_file_name}",
                "",
                "The WAV is written as 32-bit float to preserve the same headroom as live browser-clock audio.",
                "",
                "If you need a longer release tail, increase the final 'f 0 ...' duration line in the CSD.",
                "",
            ]
        )
        if warnings:
            lines.extend(["Warnings:", *[f"- {warning}" for warning in warnings], ""])
        return "\n".join(lines)

    @staticmethod
    def _format_duration(value: float) -> str:
        return f"{max(0.01, value):.6f}".rstrip("0").rstrip(".")

    @staticmethod
    def _format_score_number(value: float) -> str:
        return f"{max(0.0, value):.6f}".rstrip("0").rstrip(".") or "0"

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

    def add_stored_asset(self, stored_name: str) -> BundledAsset:
        source_path = self._gen_asset_service.resolve_audio_path(stored_name)
        if not source_path.exists():
            raise ValueError(f"Referenced audio asset '{stored_name}' does not exist on the backend.")
        if not source_path.is_file():
            raise ValueError(f"Referenced audio asset '{stored_name}' is not a file.")
        source_key = str(source_path.resolve())
        existing = self._archive_path_by_source.get(source_key)
        if existing is not None:
            return existing
        archive_path = PurePosixPath("assets") / stored_name
        bundled = BundledAsset(source_path=source_path, archive_path=str(archive_path))
        self._archive_path_by_source[source_key] = bundled
        self.assets.append(bundled)
        return bundled
