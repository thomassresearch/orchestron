"""Renderer construction shared by sessions and native baseline diagnostics."""
from __future__ import annotations

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.realtime_renderer import RealtimeRenderer


def create_realtime_renderer(
    *,
    gen_audio_assets_dir: str | None = None,
    csound_performance_logging: bool = False,
    renderer_options=None,
) -> RealtimeRenderer:
    """Default to the original worker; explicit application wiring may opt in.

    The opt-in facade retains the original worker for pre-start/next-start fallback.
    No environment flag or automatic capacity admission is enabled here.
    """
    if renderer_options is not None and renderer_options.policy.mode != "single":
        from backend.app.engine.session_parallel_renderer import ParallelCsoundRenderer
        return ParallelCsoundRenderer(options=renderer_options,
            gen_audio_assets_dir=gen_audio_assets_dir, csound_performance_logging=csound_performance_logging)
    return CsoundWorker(
        gen_audio_assets_dir=gen_audio_assets_dir,
        csound_performance_logging=csound_performance_logging,
    )
