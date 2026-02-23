from __future__ import annotations

import numpy as np

from backend.app.engine.webrtc_audio import CsoundAudioFrameBuffer


def _stereo_frame(value: float, samples: int = 4) -> np.ndarray:
    return np.full((samples, 2), value, dtype=np.float32)


def test_frame_buffer_trims_to_target_queue_size() -> None:
    buffer = CsoundAudioFrameBuffer(
        source_sample_rate=48_000,
        source_channels=2,
        target_sample_rate=48_000,
        frame_samples=4,
        queue_size=4,
        target_queue_size=2,
    )

    buffer.push_csound_block(_stereo_frame(1.0))
    buffer.push_csound_block(_stereo_frame(2.0))
    buffer.push_csound_block(_stereo_frame(3.0))
    buffer.push_csound_block(_stereo_frame(4.0))

    first = buffer.read_frame(timeout_seconds=0.0)
    second = buffer.read_frame(timeout_seconds=0.0)

    assert np.allclose(first, _stereo_frame(3.0))
    assert np.allclose(second, _stereo_frame(4.0))


def test_drop_queued_frames_keeps_latest_frames() -> None:
    buffer = CsoundAudioFrameBuffer(
        source_sample_rate=48_000,
        source_channels=2,
        target_sample_rate=48_000,
        frame_samples=4,
        queue_size=8,
        target_queue_size=8,
    )

    buffer.push_csound_block(_stereo_frame(10.0))
    buffer.push_csound_block(_stereo_frame(20.0))
    buffer.push_csound_block(_stereo_frame(30.0))

    dropped = buffer.drop_queued_frames(keep_latest=1)
    remaining = buffer.read_frame(timeout_seconds=0.0)

    assert dropped == 2
    assert np.allclose(remaining, _stereo_frame(30.0))
