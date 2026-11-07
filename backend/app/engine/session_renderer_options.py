"""Internal selection/admission wiring. Ordinary application startup stays single."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from backend.app.models.render_plan import RenderCostProfile, RenderDependencyGraph
from backend.app.models.render_protocol import RendererPolicy
from backend.app.engine.render_capacity import PROCESS_RENDER_ADMISSION, RenderAdmission
from backend.app.engine.render_qualification import QualificationEvidence


@dataclass(frozen=True)
class SessionRendererOptions:
    policy: RendererPolicy = field(default_factory=RendererPolicy)
    costs: Callable[[RenderDependencyGraph], RenderCostProfile | None] | None = None
    # Explicitly acknowledges unqualified execution for integration diagnostics.
    # Does not bypass capacity admission or claim performance qualification.
    allow_unqualified: bool = False
    admission: RenderAdmission = field(default_factory=lambda: PROCESS_RENDER_ADMISSION)
    qualifications: tuple[QualificationEvidence, ...] = ()
