from __future__ import annotations

from functools import lru_cache
import hashlib
import json
from pathlib import Path
import struct
import subprocess
from tempfile import TemporaryDirectory
from threading import BoundedSemaphore
from time import monotonic

import numpy as np

from backend.app.models.sample_player import (
    MAX_SAMPLE_SECONDS, SAMPLE_RATE, SampleAsset, SamplePlayback, SampleSource, SampleUpload, sample_asset_id,
)
from backend.app.services.gen_asset_service import GenAssetService, GenAudioAssetQuotaExceededError, GenAudioAssetTooLargeError

DECODER_REVISION = "ffmpeg-f32-v1"
DECODE_TIMEOUT = 30
_DECODERS = BoundedSemaphore(2)


def _check_canceled(canceled) -> None:
    if canceled is not None and canceled.is_set():
        raise ValueError("Sample upload was canceled.")


def _run(program: str, arguments: list[str], *, canceled=None, deadline: float | None = None) -> str:
    try:
        _check_canceled(canceled)
        with subprocess.Popen([program, *arguments], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as decoder:
            if deadline is None:
                deadline = monotonic() + DECODE_TIMEOUT
            try:
                while True:
                    _check_canceled(canceled)
                    remaining = deadline - monotonic()
                    if remaining <= 0:
                        raise subprocess.TimeoutExpired(program, DECODE_TIMEOUT)
                    try:
                        stdout, stderr = decoder.communicate(timeout=min(.25, remaining))
                    except subprocess.TimeoutExpired:
                        continue
                    if decoder.returncode:
                        raise subprocess.CalledProcessError(decoder.returncode, program, stdout, stderr)
                    return stdout
            finally:
                if decoder.poll() is None:
                    decoder.kill()
                    decoder.communicate()
    except FileNotFoundError as exc:
        raise ValueError("Sample decoding requires FFmpeg and FFprobe on the backend.") from exc
    except subprocess.TimeoutExpired as exc:
        raise ValueError("Sample decoding exceeded the time limit.") from exc
    except subprocess.CalledProcessError as exc:
        raise ValueError("Could not read sample audio. The file may be corrupt or truncated.") from exc


def _chunks(path: Path):
    with path.open("rb") as stream:
        while chunk := stream.read(128 * 1024):
            yield chunk


def _sha(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _wav_chunks(path: Path) -> dict[bytes, tuple[int, int]]:
    with path.open("rb") as stream:
        header = stream.read(12)
        if len(header) != 12 or header[:4] != b"RIFF" or header[8:12] != b"WAVE":
            raise ValueError("Invalid WAV header.")
        end = struct.unpack_from("<I", header, 4)[0] + 8
        if end > path.stat().st_size:
            raise ValueError("Truncated WAV container.")
        chunks = {}
        while stream.tell() + 8 <= end:
            kind, size = struct.unpack("<4sI", stream.read(8))
            offset = stream.tell()
            if offset + size > end:
                raise ValueError("Truncated WAV chunk.")
            if kind in {b"fmt ", b"data"}:
                if kind in chunks:
                    raise ValueError("Ambiguous WAV audio chunks.")
                chunks[kind] = (offset, size)
            stream.seek(offset + size + (size & 1))
    if b"fmt " not in chunks or b"data" not in chunks or not chunks[b"data"][1]:
        raise ValueError("WAV contains no audio.")
    return chunks


def _wav_format(path: Path):
    chunks = _wav_chunks(path)
    offset, size = chunks[b"fmt "]
    if size < 16:
        raise ValueError("Invalid WAV format chunk.")
    with path.open("rb") as stream:
        stream.seek(offset)
        code, channels, rate, _, align, bits = struct.unpack("<HHIIHH", stream.read(16))
    data_offset, data_size = chunks[b"data"]
    if not align or data_size % align:
        raise ValueError("WAV contains an incomplete audio frame.")
    return code, channels, rate, align, bits, data_offset, data_size


def _probe(path: Path, fmt: str, *, canceled=None, deadline=None) -> int:
    result = _run("ffprobe", [
        "-v", "error", "-max_alloc", "67108864", "-protocol_whitelist", "file",
        "-f", fmt, "-select_streams", "a", "-show_entries", "stream=codec_type,codec_name,channels", "-of", "json", str(path),
    ], canceled=canceled, deadline=deadline)
    audio = [s for s in json.loads(result).get("streams", []) if s["codec_type"] == "audio"]
    if len(audio) != 1 or (fmt == "mp3" and audio[0].get("codec_name") != "mp3"):
        raise ValueError("Samples must contain one WAV or MP3 audio stream.")
    channels = audio[0].get("channels")
    if channels not in (1, 2):
        raise ValueError("Samples must have one or two audio channels.")
    return channels


def _source_format(path: Path) -> tuple[str, int]:
    with path.open("rb") as stream:
        prefix = stream.read(12)
    if prefix[:4] == b"RIFF" and prefix[8:12] == b"WAVE":
        code, channels, _, _, bits, offset, size = _wav_format(path)
        if channels not in (1, 2):
            raise ValueError("Samples must have one or two audio channels.")
        if code == 3 and bits in (32, 64):
            _check_finite(path, offset=offset, size=size, dtype="<f4" if bits == 32 else "<f8")
        return "wav", channels
    if prefix[:3] == b"ID3" or len(prefix) >= 2 and prefix[0] == 255 and prefix[1] & 224 == 224:
        return "mp3", _validate_mp3_frames(path)
    raise ValueError("Unsupported sample format. Choose a WAV or MP3 file.")


def _validate_mp3_frames(path: Path) -> int:
    """FFmpeg can conceal a truncated last frame; check the frame boundaries first."""
    rates = {0: (11025, 12000, 8000), 2: (22050, 24000, 16000), 3: (44100, 48000, 32000)}
    low_bitrates = (8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)
    high_bitrates = (32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320)
    with path.open("rb") as stream:
        end = path.stat().st_size
        start = 0
        prefix = stream.read(10)
        if prefix[:3] == b"ID3":
            if len(prefix) != 10 or any(x & 128 for x in prefix[6:]):
                raise ValueError("Invalid MP3 metadata header.")
            start = 10 + sum(value << (7 * (3 - index)) for index, value in enumerate(prefix[6:]))
            if prefix[3] == 4 and prefix[5] & 16:
                start += 10
        if end >= 128:
            stream.seek(end - 128)
            if stream.read(3) == b"TAG":
                end -= 128
        if end >= 32:
            stream.seek(end - 32)
            if (footer := stream.read(32)).startswith(b"APETAGEX"):
                tag_size = int.from_bytes(footer[12:16], "little")
                if not 32 <= tag_size <= end - start:
                    raise ValueError("Invalid MP3 metadata footer.")
                end -= tag_size
                if end - start >= 32:
                    stream.seek(end - 32)
                    if stream.read(8) == b"APETAGEX":
                        end -= 32
        position = start
        frames = 0
        expected_frames = None
        expected_bytes = None
        channels = 0
        seconds = 0.0
        while position < end:
            stream.seek(position)
            raw = stream.read(4)
            header = int.from_bytes(raw, "big")
            version, layer = (header >> 19) & 3, (header >> 17) & 3
            bitrate, rate = (header >> 12) & 15, (header >> 10) & 3
            if (len(raw) != 4 or header >> 21 != 0x7ff or version not in rates
                    or layer != 1 or not 1 <= bitrate <= 14 or rate == 3):
                raise ValueError("Invalid or unsupported MP3 frame.")
            if version == 3:
                divisor, bitrates, samples = 144000, high_bitrates, 1152
            else:
                divisor, bitrates, samples = 72000, low_bitrates, 576
            hz = rates[version][rate]
            length = divisor * bitrates[bitrate - 1] // hz + ((header >> 9) & 1)
            if position + length > end:
                raise ValueError("Truncated MP3 audio frame.")
            mono = ((header >> 6) & 3) == 3
            frame_channels = 1 if mono else 2
            if channels and frame_channels != channels:
                raise ValueError("Sample MP3 audio must keep the same channel count.")
            channels = frame_channels
            if frames == 0:
                side = (17 if mono else 32) if version == 3 else (9 if mono else 17)
                crc = 0 if header & (1 << 16) else 2
                if 20 + side + crc <= length:
                    stream.seek(position + 4 + side + crc)
                    tag, flags, first, second = struct.unpack(">4sIII", stream.read(16))
                    if tag in {b"Xing", b"Info"}:
                        if flags & 1:
                            expected_frames = first
                        if flags & 2:
                            expected_bytes = second if flags & 1 else first
            frames += 1
            seconds += samples / hz
            if seconds > MAX_SAMPLE_SECONDS + 1:
                raise GenAudioAssetTooLargeError("Sample exceeds the decoded audio duration limit.")
            position += length
        if (not frames or expected_frames is not None and frames < expected_frames
                or expected_bytes is not None and end - start < expected_bytes):
            raise ValueError("MP3 is empty or missing audio frames.")
        return channels


def _check_finite(path: Path, *, offset: int = 0, size: int | None = None, dtype: str = "<f4") -> None:
    with path.open("rb") as stream:
        stream.seek(offset)
        remaining = path.stat().st_size if size is None else size
        width = np.dtype(dtype).itemsize
        while remaining:
            data = stream.read(min(remaining, 128 * 1024))
            if not data or len(data) % width or not np.isfinite(np.frombuffer(data, dtype=dtype)).all():
                raise ValueError("Sample contains invalid floating-point audio.")
            remaining -= len(data)


def _canonical(path: Path, raw: Path, *, channels: int, size: int) -> None:
    align = channels * 4
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + size, b"WAVE", b"fmt ", 16, 3,
        channels, SAMPLE_RATE, SAMPLE_RATE * align, align, 32, b"data", size,
    )
    with path.open("wb") as output:
        output.write(header)
        for chunk in _chunks(raw):
            output.write(chunk)


def _file_fields(path: Path, fmt: str) -> dict:
    digest = _sha(path)
    return {"stored_name": f"sam-{digest}.{fmt}", "sha256": digest, "size_bytes": path.stat().st_size}


def _validate_playback(path: Path, ref: SamplePlayback):
    code, channels, rate, align, bits, offset, size = _wav_format(path)
    if (code, channels, rate, align, bits, size) != (
        3, ref.channels, ref.sample_rate, ref.channels * 4, 32, ref.frame_count * ref.channels * 4,
    ):
        raise ValueError("Sample WAV does not match its playback metadata.")
    _check_finite(path, offset=offset, size=size)


def _stat_key(path: Path) -> tuple[int, ...]:
    stat = path.stat()
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


@lru_cache(maxsize=4_096)
def _verify(path: Path, stat: tuple[int, ...], metadata: str, revision: str, *, playback: bool, channels: int):
    ref = (SamplePlayback if playback else SampleSource).model_validate_json(metadata)
    if stat[2] != ref.size_bytes or _sha(path) != ref.sha256:
        raise ValueError("Sample file content does not match its manifest.")
    if playback:
        _validate_playback(path, ref)
    elif _source_format(path) != (ref.format, channels):
        raise ValueError("Sample source format or channel count does not match its manifest.")


def verify_sample_asset(asset: SampleAsset, paths) -> None:
    for ref, playback in ((asset.source, False), (asset.playback, True)):
        path = paths(ref.stored_name)
        try:
            _verify(path, _stat_key(path), ref.model_dump_json(exclude={"original_name"}) if playback else
                    ref.model_copy(update={"original_name": ref.stored_name}).model_dump_json(),
                    asset.decoder_revision, playback=playback, channels=asset.playback.channels)
        except FileNotFoundError as exc:
            raise ValueError(f"Managed sample file is missing: {ref.stored_name}.") from exc


def verify_sample_assets(assets, store: GenAssetService) -> None:
    for identity, asset in assets.items():
        if identity != sample_asset_id(asset):
            raise ValueError("Sample asset ID does not match its content.")
        if max(asset.source.size_bytes, asset.playback.size_bytes) > store.max_audio_asset_bytes:
            raise GenAudioAssetTooLargeError("Sample file exceeds the audio asset size limit.")
        verify_sample_asset(asset, store.resolve_audio_path)


def decode_sample(source: Path, filename: str, store: GenAssetService, *, canceled=None, quota_retry=None) -> SampleUpload:
    if not source.stat().st_size:
        raise ValueError("Sample upload is empty.")
    if not _DECODERS.acquire(blocking=False):
        raise ValueError("Sample decoder is busy. Try again shortly.")
    try:
        deadline = monotonic() + DECODE_TIMEOUT
        _check_canceled(canceled)
        fmt, source_channels = _source_format(source)
        with TemporaryDirectory(prefix="orchestron-sample-") as folder:
            raw = Path(folder) / "decoded.pcm"
            canonical = Path(folder) / "playback.wav"
            channels = _probe(source, fmt, canceled=canceled, deadline=deadline)
            if channels != source_channels:
                raise ValueError("Decoded sample channel count does not match the source.")
            align = channels * 4
            limit = min(store.max_audio_asset_bytes - 44, MAX_SAMPLE_SECONDS * SAMPLE_RATE * align)
            if limit < align:
                raise GenAudioAssetTooLargeError("Sample exceeds the decoded audio size limit.")
            _run("ffmpeg", [
                "-nostdin", "-v", "error", "-xerror", "-max_alloc", "67108864",
                "-protocol_whitelist", "file", "-threads", "1", "-f", fmt, "-i", str(source),
                "-map", "0:a:0", "-vn", "-sn", "-dn", "-ar", str(SAMPLE_RATE),
                "-c:a", "pcm_f32le", "-f", "f32le", "-fs", str(limit + align), str(raw),
            ], canceled=canceled, deadline=deadline)
            size = raw.stat().st_size
            if size > limit:
                raise GenAudioAssetTooLargeError("Sample exceeds the duration or decoded audio size limit.")
            if size <= 0 or size % align:
                raise ValueError("Sample contains no complete audio frames.")
            _check_finite(raw)
            _canonical(canonical, raw, channels=channels, size=size)
            original_name = filename.replace("\\", "/").split("/")[-1].replace("\x00", "").strip()[:255]
            asset = SampleAsset(
                source=SampleSource(**_file_fields(source, fmt), original_name=original_name or f"sample.{fmt}", format=fmt),
                playback=SamplePlayback(**_file_fields(canonical, "wav"), sample_rate=SAMPLE_RATE, channels=channels,
                                        frame_count=size // align, format="wav-f32le"),
                decoder_revision=DECODER_REVISION,
            )
            names = {asset.source.stored_name: source, asset.playback.stored_name: canonical}
            def commit():
                with store.import_batch(names):
                    for name, path in names.items():
                        _check_canceled(canceled)
                        store.import_audio_chunks_with_stored_name(stored_name=name, chunks=_chunks(path))
                    _check_canceled(canceled)
                    for name in names:
                        store.lease_audio_asset(name)
            try:
                commit()
            except GenAudioAssetQuotaExceededError:
                if quota_retry is None:
                    raise
                quota_retry()
                commit()
            return SampleUpload(asset_id=sample_asset_id(asset), asset=asset)
    finally:
        _DECODERS.release()
