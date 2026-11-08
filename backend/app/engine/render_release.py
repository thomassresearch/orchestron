"""Graph-based playback selection and offline benchmark report schemas."""
from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.app.engine.render_qualification import QualificationEvidence
from backend.app.engine.session_renderer_options import SessionRendererOptions
from backend.app.models.render_plan import RenderCostProfile, RenderStageCost
from backend.app.models.render_protocol import Digest, RendererPolicy

MAX_CATALOG_BYTES = 1024 * 1024


def settings_key(value):
    if isinstance(value, str):
        value = json.loads(value)
    if (not isinstance(value, dict) or not value or len(value) > 32
            or any(not isinstance(k, str) or len(k) > 100 or type(v) not in (str, int)
                   or (isinstance(v, str) and len(v) > 100) for k, v in value.items())):
        raise ValueError("Expected bounded browser playback settings")
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


class StageCostRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, allow_inf_nan=False)
    stage: str = Field(min_length=1, max_length=256)
    microseconds: int | float = Field(ge=0)


class CostProfileRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, allow_inf_nan=False)
    provenance: str = Field(min_length=1, max_length=1024)
    stages: tuple[StageCostRecord, ...] = Field(min_length=1, max_length=4096)
    # Preserve integer/float representation: these numbers enter the plan hash.
    dispatch_microseconds: int | float = Field(ge=0)
    copy_microseconds_per_sample: int | float = Field(ge=0)
    minimum_reduction: int | float = Field(default=.2, ge=0, lt=1)

    def to_profile(self):
        return RenderCostProfile(self.provenance, tuple(RenderStageCost(s.stage, s.microseconds) for s in self.stages),
            self.dispatch_microseconds, self.copy_microseconds_per_sample, self.minimum_reduction)


class ReleaseProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, allow_inf_nan=False)
    input_hash: Digest
    costs: CostProfileRecord
    evidence: QualificationEvidence

    @model_validator(mode="after")
    def valid_evidence(self):
        if self.evidence.rejection() is not None:
            raise ValueError("Release evidence did not pass qualification")
        for name in ("runtime", "artifact_hash", "plan_hash", "report_digest"):
            value = getattr(self.evidence, name)
            if len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
                raise ValueError("Expected exact qualification digests")
        settings_key(self.evidence.single_settings)
        if not self.costs.stages or len(self.costs.stages) > 4096:
            raise ValueError("Expected bounded stage costs")
        return self


class ReleaseCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, allow_inf_nan=False)
    version: Literal[1]
    policy: RendererPolicy
    profiles: tuple[ReleaseProfile, ...] = Field(min_length=2, max_length=64)

    @model_validator(mode="after")
    def fallback_policy(self):
        if self.policy.mode != "auto":
            raise ValueError("Released opt-in playback must retain single fallback")
        keys = [(p.evidence.runtime, p.input_hash, settings_key(p.evidence.single_settings)) for p in self.profiles]
        if len(set(keys)) != len(keys):
            raise ValueError("Duplicate release profile")
        return self


class RenderRelease:
    """Deployment switch for graph-based opt-in playback.

    ReleaseCatalog remains a benchmark report format for offline validation. It
    is deliberately not read here: ordinary performances need no song/build/
    browser-settings registration, and browser buffers never affect ownership.
    """
    def __init__(self, settings):
        self.settings = settings

    def options(self, browser_settings=None, *, parallel_batch_frames: int | None = None):
        return SessionRendererOptions(
            policy=RendererPolicy(mode="auto", coordination_frames=(
                self.settings.parallel_render_batch_frames if parallel_batch_frames is None else parallel_batch_frames)),
            graph_selection=True,
            blocked_reason=None if self.settings.parallel_playback_enabled else "parallel_disabled",
            enabled=lambda: self.settings.parallel_playback_enabled)
