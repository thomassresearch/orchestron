"""Explicit application wiring for T06 qualification; no deployment auto-admission."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from backend.app.models.render_plan import RenderCostProfile, RenderDependencyGraph
from backend.app.models.render_protocol import RendererPolicy


@dataclass(frozen=True)
class SessionRendererOptions:
    policy: RendererPolicy = field(default_factory=RendererPolicy)
    costs: Callable[[RenderDependencyGraph], RenderCostProfile | None] | None = None
    # Explicitly acknowledges unqualified execution for integration diagnostics.
    # T07 must replace this hook with measured admission before deployment selection.
    allow_unqualified: bool = False
