from __future__ import annotations

from typing import Any

DEFAULT_BROWSER_AUDIO_SAMPLE_RATE = 48_000


def normalize_csound_spout_to_stereo(spout: Any, *, source_channels: int) -> Any:
    import numpy as np  # type: ignore

    raw = np.asarray(spout, dtype=np.float32)
    if raw.size == 0:
        return np.zeros((0, 2), dtype=np.float32)

    channels = max(1, int(source_channels))
    if raw.ndim == 2:
        if raw.shape[-1] == channels:
            frames = raw.reshape(-1, channels)
        elif raw.shape[0] == channels:
            frames = raw.T
        else:
            flattened = raw.reshape(-1)
            frame_count = flattened.size // channels
            frames = flattened[: frame_count * channels].reshape(frame_count, channels)
    else:
        flattened = raw.reshape(-1)
        frame_count = flattened.size // channels
        if frame_count == 0:
            return np.zeros((0, 2), dtype=np.float32)
        frames = flattened[: frame_count * channels].reshape(frame_count, channels)

    if frames.shape[1] == 1:
        mono = frames[:, 0:1]
        return np.repeat(mono, 2, axis=1)
    if frames.shape[1] >= 2:
        return np.ascontiguousarray(frames[:, :2], dtype=np.float32)

    return np.zeros((0, 2), dtype=np.float32)


def resample_stereo_block_linear(block: Any, *, source_sample_rate: int, target_sample_rate: int) -> Any:
    import numpy as np  # type: ignore

    in_samples = int(block.shape[0])
    if in_samples == 0:
        return block
    if in_samples == 1 or source_sample_rate == target_sample_rate:
        return np.ascontiguousarray(block, dtype=np.float32)

    ratio = target_sample_rate / source_sample_rate
    out_samples = max(1, int(round(in_samples * ratio)))
    if out_samples == in_samples:
        return np.ascontiguousarray(block, dtype=np.float32)

    src_x = np.arange(in_samples, dtype=np.float64)
    dst_x = np.linspace(0.0, float(in_samples - 1), num=out_samples, endpoint=True, dtype=np.float64)
    left = np.interp(dst_x, src_x, block[:, 0].astype(np.float64, copy=False)).astype(np.float32)
    right = np.interp(dst_x, src_x, block[:, 1].astype(np.float64, copy=False)).astype(np.float32)
    return np.stack([left, right], axis=1)


def csound_spout_to_pcm_block(
    spout: Any,
    *,
    source_channels: int,
    source_sample_rate: int,
    target_sample_rate: int,
) -> Any:
    block = normalize_csound_spout_to_stereo(spout, source_channels=source_channels)
    if getattr(block, "size", 0) == 0:
        return block
    if source_sample_rate != target_sample_rate:
        return resample_stereo_block_linear(
            block,
            source_sample_rate=source_sample_rate,
            target_sample_rate=target_sample_rate,
        )
    return block
