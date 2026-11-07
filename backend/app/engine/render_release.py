"""Operator-owned, exact-build qualification catalog for opt-in playback.

No synthetic costs, historic build aliases or unqualified override are exposed
through deployment settings or the session API. The file lives outside app source
so adding evidence cannot change the runtime fingerprint it certifies.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.app.engine.render_qualification import QualificationEvidence, runtime_fingerprint
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
    def __init__(self, settings):
        self.catalog = None
        self.reason = None
        self.settings = settings
        if not settings.parallel_playback_enabled:
            self.reason = "parallel_disabled"
        elif settings.parallel_qualification_file is None:
            self.reason = "parallel_not_qualified"
        else:
            try:
                with Path(settings.parallel_qualification_file).open("rb") as stream:
                    raw = stream.read(MAX_CATALOG_BYTES + 1)
                if len(raw) > MAX_CATALOG_BYTES:
                    raise ValueError("Qualification catalog exceeds size limit")
                self.catalog = ReleaseCatalog.model_validate_json(raw)
            except (OSError, ValueError):
                self.reason = "qualification_catalog_invalid"
                logging.getLogger(__name__).warning("Parallel qualification catalog unavailable or invalid; using single rendering")

    def options(self, browser_settings):
        reason = "parallel_disabled" if not self.settings.parallel_playback_enabled else self.reason
        profiles = ()
        if not reason:
            try:
                runtime = runtime_fingerprint()
                key = settings_key(browser_settings)
                current = tuple(p for p in self.catalog.profiles if p.evidence.runtime == runtime)
                if not current:
                    reason = "qualification_build_mismatch"
                profiles = tuple(p for p in current if settings_key(p.evidence.single_settings) == key)
            except Exception:
                reason = "qualification_unavailable"
            if not profiles and not reason:
                reason = "browser_settings_not_qualified"

        def costs(graph):
            # Exact source/engine/resource identity, followed by exact compiled
            # artifact/plan/build checks in the facade. No node-count estimates.
            return next((p.costs.to_profile() for p in profiles if p.input_hash == graph.input_hash), None)

        return SessionRendererOptions(
            policy=self.catalog.policy if self.catalog else RendererPolicy(mode="auto"),
            costs=costs, qualifications=tuple(p.evidence for p in profiles), blocked_reason=reason,
            enabled=lambda: self.settings.parallel_playback_enabled)
