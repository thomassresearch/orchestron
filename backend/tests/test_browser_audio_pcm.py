from __future__ import annotations

import numpy as np
import pytest

from backend.app.engine.browser_audio_pcm import (
    create_csound_spout_copier,
    csound_spout_to_pcm_block,
    normalize_csound_spout_to_stereo,
    resample_stereo_block_linear,
)


@pytest.mark.parametrize("frames", [1, 5])
@pytest.mark.parametrize("channels", [1, 2, 4])
@pytest.mark.parametrize("layout", ["flat", "interleaved", "planar"])
@pytest.mark.parametrize("dtype", [np.float32, np.float64])
def test_spout_copier_preserves_bytes_when_csound_reuses_or_replaces_buffer(frames, channels, layout, dtype):
    copy = create_csound_spout_copier(source_channels=channels, block_frames=frames)
    output = np.empty((frames, 2), dtype=np.float32)
    for _ in range(2):  # Some bindings return a fresh array on every spout call.
        samples = np.empty((frames, channels), dtype=dtype)
        spout = samples.reshape(-1) if layout == "flat" else samples.T if layout == "planar" else samples
        for value in (1 / 7, -0.0, np.inf, np.nan, -1 / 3):
            samples[:] = value
            expected = normalize_csound_spout_to_stereo(spout, source_channels=channels)
            copy(spout, output)
            assert output.tobytes() == expected.tobytes()
            saved = output.copy()
            samples.fill(99)  # Returned PCM must not alias Csound's next period.
            assert output.tobytes() == saved.tobytes()


def test_spout_copier_retains_unusual_layout_validation():
    copy = create_csound_spout_copier(source_channels=2, block_frames=3)
    output = np.empty((3, 2), dtype=np.float32)
    for spout in (np.arange(6).reshape(1, 2, 3), list(range(6))):
        copy(spout, output)
        assert output.tobytes() == normalize_csound_spout_to_stereo(spout, source_channels=2).tobytes()
    for spout in (np.array([]), np.array([1]), np.arange(4)):
        with pytest.raises(ValueError):
            copy(spout, output)


def test_normalize_csound_spout_to_stereo_upsamples_mono() -> None:
    mono = np.array([0.1, 0.2, 0.3], dtype=np.float32)
    stereo = normalize_csound_spout_to_stereo(mono, source_channels=1)

    assert stereo.shape == (3, 2)
    assert np.allclose(stereo[:, 0], mono)
    assert np.allclose(stereo[:, 1], mono)


@pytest.mark.parametrize("channels", [1, 2, 4])
@pytest.mark.parametrize("layout", ["flat", "interleaved", "planar"])
@pytest.mark.parametrize("dtype", [np.float32, np.float64])
def test_normalize_copies_into_reusable_output(channels, layout, dtype) -> None:
    frames = np.arange(5 * channels, dtype=dtype).reshape(5, channels) / 7
    spout = frames.flatten() if layout == "flat" else frames.T if layout == "planar" else frames
    expected = normalize_csound_spout_to_stereo(spout, source_channels=channels).copy()
    output = np.empty((5, 2), dtype=np.float32)

    assert normalize_csound_spout_to_stereo(spout, source_channels=channels, out=output) is output
    spout.fill(-99)
    np.testing.assert_array_equal(output, expected)


@pytest.mark.parametrize("samples", [[], [1], [1, 2, 3, 4]])
def test_normalize_rejects_incomplete_output_instead_of_leaving_stale_pcm(samples) -> None:
    output = np.full((3, 2), 99, dtype=np.float32)
    with pytest.raises(ValueError):
        normalize_csound_spout_to_stereo(np.array(samples), source_channels=2, out=output)


def test_resample_stereo_block_linear_changes_frame_count() -> None:
    block = np.array(
        [
            [0.0, 0.0],
            [0.5, 0.5],
            [1.0, 1.0],
            [0.5, 0.5],
        ],
        dtype=np.float32,
    )
    resampled = resample_stereo_block_linear(block, source_sample_rate=44_100, target_sample_rate=48_000)

    assert resampled.shape == (4, 2) or resampled.shape == (5, 2)
    assert np.isfinite(resampled).all()


def test_csound_spout_to_pcm_block_resamples_and_keeps_stereo_layout() -> None:
    spout = np.array(
        [
            [0.1, -0.1],
            [0.2, -0.2],
            [0.3, -0.3],
            [0.4, -0.4],
        ],
        dtype=np.float32,
    )
    pcm = csound_spout_to_pcm_block(
        spout,
        source_channels=2,
        source_sample_rate=44_100,
        target_sample_rate=48_000,
    )

    assert pcm.shape[1] == 2
    assert np.isfinite(pcm).all()
