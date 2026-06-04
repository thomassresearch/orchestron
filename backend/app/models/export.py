from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.app.models.patch import PatchGraph
from backend.app.models.session import SessionSequencerConfigRequest, SessionSequencerStepConfig

OFFLINE_CSD_EXPORT_MAX_PLAYBACK_STEPS = 65_536
OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS = 200_000
OFFLINE_CSD_EXPORT_MAX_STEP_NOTES = 16
OFFLINE_CSD_EXPORT_MAX_WALL_SECONDS = 5.0
_OFFLINE_CONTROLLER_EVENTS_PER_TRANSPORT_STEP = 15
_OFFLINE_ARPEGGIATOR_EVENTS_PER_TRANSPORT_STEP = OFFLINE_CSD_EXPORT_MAX_STEP_NOTES * 4 * 2


class ExportPerformanceInstrumentAssignment(BaseModel):
    patch_id: str = Field(alias="patchId", min_length=1)
    patch_name: str | None = Field(default=None, alias="patchName")
    midi_channel: int = Field(alias="midiChannel", ge=1, le=16)

    model_config = ConfigDict(populate_by_name=True)


class ExportPerformanceConfig(BaseModel):
    version: int = 1
    instruments: list[ExportPerformanceInstrumentAssignment] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class ExportedPatchDefinition(BaseModel):
    source_patch_id: str = Field(alias="sourcePatchId", min_length=1)
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2_048)
    schema_version: int = 1
    graph: PatchGraph

    model_config = ConfigDict(populate_by_name=True)


class ExportedPerformanceDocument(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2_048)
    config: ExportPerformanceConfig


class PerformanceExportPayload(BaseModel):
    format: Literal["orchestron.performance"]
    version: Literal[1]
    exported_at: str
    performance: ExportedPerformanceDocument
    patch_definitions: list[ExportedPatchDefinition] = Field(default_factory=list)


class PerformanceCsdExportRequest(BaseModel):
    performance_export: PerformanceExportPayload = Field(alias="performanceExport")
    sequencer_config: SessionSequencerConfigRequest = Field(alias="sequencerConfig")

    @model_validator(mode="after")
    def validate_offline_export_budget(self) -> "PerformanceCsdExportRequest":
        config = self.sequencer_config
        playback_steps = config.playback_end_step - config.playback_start_step
        if playback_steps > OFFLINE_CSD_EXPORT_MAX_PLAYBACK_STEPS:
            raise ValueError(
                "Offline performance CSD export playback range exceeds "
                f"{OFFLINE_CSD_EXPORT_MAX_PLAYBACK_STEPS} transport steps."
            )
        if config.playback_loop:
            raise ValueError("Offline performance CSD export does not support looping playback.")

        for track in config.tracks:
            for pad in track.pads:
                for step in pad.steps:
                    note_count = _sequencer_step_note_count(step)
                    if note_count > OFFLINE_CSD_EXPORT_MAX_STEP_NOTES:
                        raise ValueError(
                            "Offline performance CSD export step note lists cannot exceed "
                            f"{OFFLINE_CSD_EXPORT_MAX_STEP_NOTES} notes."
                        )

        estimated_events = self._estimate_offline_midi_event_count(playback_steps)
        if estimated_events > OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS:
            raise ValueError(
                "Offline performance CSD export would generate too many MIDI events "
                f"({estimated_events} estimated, limit {OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS})."
            )
        return self

    def _estimate_offline_midi_event_count(self, playback_steps: int) -> int:
        playback_steps = max(1, int(playback_steps))
        event_count = 0
        for track in self.sequencer_config.tracks:
            if not track.enabled:
                continue
            max_step_notes = max(
                (
                    _sequencer_step_note_count(step)
                    for pad in track.pads
                    for step in pad.steps
                ),
                default=0,
            )
            if max_step_notes <= 0:
                continue
            event_count += playback_steps * max_step_notes * 2

        fallback_channels = {
            assignment.midi_channel
            for assignment in self.performance_export.performance.config.instruments
            if 1 <= assignment.midi_channel <= 16
        } or {1}
        for track in self.sequencer_config.controller_tracks:
            if not track.enabled:
                continue
            target_channel_count = len(track.target_channels) if track.target_channels else len(fallback_channels)
            if target_channel_count <= 0:
                continue
            event_count += playback_steps * _OFFLINE_CONTROLLER_EVENTS_PER_TRANSPORT_STEP * target_channel_count

        enabled_arpeggiators = sum(1 for arpeggiator in self.sequencer_config.arpeggiators if arpeggiator.enabled)
        if enabled_arpeggiators > 0:
            event_count += playback_steps * enabled_arpeggiators * _OFFLINE_ARPEGGIATOR_EVENTS_PER_TRANSPORT_STEP

        return event_count

    model_config = ConfigDict(populate_by_name=True)


def _sequencer_step_note_count(step: object) -> int:
    note_value: object
    if isinstance(step, SessionSequencerStepConfig):
        note_value = step.note
    elif isinstance(step, dict):
        note_value = step.get("note", step.get("notes"))
    else:
        note_value = step

    if note_value is None:
        return 0
    if isinstance(note_value, int):
        return 1
    if isinstance(note_value, list):
        unique_notes: set[int] = set()
        for note in note_value:
            if isinstance(note, int):
                unique_notes.add(max(0, min(127, int(note))))
            else:
                return OFFLINE_CSD_EXPORT_MAX_STEP_NOTES + 1
        return len(unique_notes)
    return OFFLINE_CSD_EXPORT_MAX_STEP_NOTES + 1
