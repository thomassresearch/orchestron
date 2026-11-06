"""Renderer construction shared by sessions and native baseline diagnostics."""
from __future__ import annotations

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.realtime_renderer import RealtimeRenderer


def create_realtime_renderer(
    *,
    gen_audio_assets_dir: str | None = None,
    csound_performance_logging: bool = False,
) -> RealtimeRenderer:
    """Always select the original single renderer, also the future fallback.

    Native availability and explicit mock mode retain CsoundWorker's behavior.
    No parallel policy is active; native compile/start failures still propagate.
    """
    return CsoundWorker(
        gen_audio_assets_dir=gen_audio_assets_dir,
        csound_performance_logging=csound_performance_logging,
    )
