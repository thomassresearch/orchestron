"""The versioned, explicit performance audio graph and its scalar controls."""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class AudioModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class AudioPortGroup(AudioModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    direction: Literal["input", "output"]
    layout: Literal["mono", "stereo", "custom"] = "stereo"
    ports: list[str] = Field(min_length=1, max_length=64)
    purpose: Literal["main", "aux", "sidechain", "custom"] = "main"

    @model_validator(mode="after")
    def validate_layout(self):
        expected = {"mono": 1, "stereo": 2}.get(self.layout)
        if expected is not None and len(self.ports) != expected:
            raise ValueError(f"{self.layout} groups require {expected} ports")
        if len(set(self.ports)) != len(self.ports):
            raise ValueError("Audio group ports must be distinct")
        return self


class AudioInterface(AudioModel):
    role: Literal["instrument", "effect", "output", "custom"] = "custom"
    groups: list[AudioPortGroup] = Field(default_factory=list, max_length=128)
    main_input: str | None = Field(default=None, alias="mainInput")
    main_output: str | None = Field(default=None, alias="mainOutput")
    guided: bool = False

    @model_validator(mode="after")
    def validate_groups(self):
        ids = [group.id for group in self.groups]
        if len(ids) != len(set(ids)):
            raise ValueError("Audio group IDs must be unique")
        for selected, direction in ((self.main_input, "input"), (self.main_output, "output")):
            if selected is not None and not any(g.id == selected and g.direction == direction for g in self.groups):
                raise ValueError(f"Unknown main {direction} group '{selected}'")
        return self


class MixerStrip(AudioModel):
    gain_db: float | None = Field(default=0.0, alias="gainDb", ge=-60, le=12)
    balance: float = Field(default=0.0, ge=-1, le=1)
    mute: bool = False
    solo: bool = False

    @field_validator("gain_db", "balance")
    @classmethod
    def finite(cls, value):
        if value is not None and not math.isfinite(value):
            raise ValueError("Mixer values must be finite")
        return value


class MixerSend(AudioModel):
    gain_db: float | None = Field(default=None, alias="gainDb", ge=-60, le=6)
    tap: Literal["pre", "post"] = "post"

    @field_validator("gain_db")
    @classmethod
    def finite(cls, value):
        if value is not None and not math.isfinite(value):
            raise ValueError("Send gain must be finite")
        return value


class MixerState(AudioModel):
    strips: dict[str, MixerStrip] = Field(default_factory=dict, max_length=64)
    sends: dict[str, MixerSend] = Field(default_factory=dict, max_length=1024)


class AudioRoute(AudioModel):
    id: str = Field(min_length=1, max_length=128)
    source_id: str = Field(alias="sourceId", min_length=1, max_length=128)
    source_port: str = Field(alias="sourcePort", min_length=1, max_length=128)
    target_id: str = Field(alias="targetId", min_length=1, max_length=128)
    target_port: str = Field(alias="targetPort", min_length=1, max_length=128)
    kind: Literal["main", "send", "insert", "custom"] = "custom"
    source_stage: Literal["raw", "strip"] = Field(default="strip", alias="sourceStage")
    target_stage: Literal["input", "strip"] = Field(default="input", alias="targetStage")


class AudioGraph(AudioModel):
    routes: list[AudioRoute] = Field(default_factory=list, max_length=1024)
    master_id: str | None = Field(default=None, alias="masterId")
    insert_owners: dict[str, str] = Field(default_factory=dict, alias="insertOwners", max_length=64)

    @model_validator(mode="after")
    def unique_routes(self):
        ids = [route.id for route in self.routes]
        if len(ids) != len(set(ids)):
            raise ValueError("Audio route IDs must be unique")
        return self


class AudioDiagnostic(AudioModel):
    code: str
    message: str
    severity: Literal["warning", "error"] = "warning"
    instance_id: str | None = Field(default=None, alias="instanceId")
    route_id: str | None = Field(default=None, alias="routeId")


class MixerUpdate(AudioModel):
    strips: dict[str, MixerStrip] = Field(default_factory=dict, max_length=64)
    sends: dict[str, MixerSend] = Field(default_factory=dict, max_length=1024)
    revision: int | None = Field(default=None, ge=0)


def linear_gain(value: float | None) -> float:
    return 0.0 if value is None else 10.0 ** (value / 20.0)


def legacy_gain(level: float | None) -> float:
    return 20.0 * math.log10(max(1.0, min(10.0, level if level is not None else 10.0)) / 10.0)
