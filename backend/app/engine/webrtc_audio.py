from __future__ import annotations

import asyncio
import logging
import queue
import time
from fractions import Fraction
from typing import Any

logger = logging.getLogger(__name__)

WEBRTC_AUDIO_SAMPLE_RATE = 48_000
WEBRTC_AUDIO_FRAME_MS = 20
WEBRTC_AUDIO_FRAME_SAMPLES = WEBRTC_AUDIO_SAMPLE_RATE * WEBRTC_AUDIO_FRAME_MS // 1000
DEFAULT_FRAME_QUEUE_SIZE = 64
WEBRTC_AUDIO_STATS_LOG_INTERVAL_SECONDS = 2.0


class CsoundAudioFrameBuffer:
    def __init__(
        self,
        *,
        source_sample_rate: int,
        source_channels: int,
        target_sample_rate: int = WEBRTC_AUDIO_SAMPLE_RATE,
        frame_samples: int = WEBRTC_AUDIO_FRAME_SAMPLES,
        queue_size: int = DEFAULT_FRAME_QUEUE_SIZE,
    ) -> None:
        import numpy as np  # type: ignore

        if source_sample_rate < 1:
            raise ValueError("source_sample_rate must be >= 1")
        if source_channels < 1:
            raise ValueError("source_channels must be >= 1")
        if target_sample_rate < 1:
            raise ValueError("target_sample_rate must be >= 1")
        if frame_samples < 1:
            raise ValueError("frame_samples must be >= 1")

        self._np = np
        self.source_sample_rate = int(source_sample_rate)
        self.source_channels = int(source_channels)
        self.target_sample_rate = int(target_sample_rate)
        self.frame_samples = int(frame_samples)
        self._frames: queue.Queue[Any] = queue.Queue(maxsize=max(1, queue_size))
        self._pending_blocks: list[Any] = []
        self._pending_sample_count = 0
        self._closed = False
        self._silence = np.zeros((self.frame_samples, 2), dtype=np.float32)
        self._ingest_stats_window_started_at: float | None = None
        self._ingest_stats_min: float | None = None
        self._ingest_stats_max: float | None = None
        self._ingest_stats_blocks = 0

    def push_csound_block(self, spout: Any) -> None:
        if self._closed:
            return

        block = self._normalize_to_stereo(spout)
        if block.size == 0:
            return

        if self.source_sample_rate != self.target_sample_rate:
            block = self._resample_block_linear(block)
            if block.size == 0:
                return

        self._maybe_log_ingest_stats(block)
        self._pending_blocks.append(block)
        self._pending_sample_count += int(block.shape[0])
        while self._pending_sample_count >= self.frame_samples:
            frame_block = self._pop_pending(self.frame_samples)
            self._enqueue_frame(frame_block)

    def read_frame(self, timeout_seconds: float = 1.0) -> Any:
        if self._closed and self._frames.empty():
            return self._silence.copy()

        try:
            return self._frames.get(timeout=max(0.0, timeout_seconds))
        except queue.Empty:
            return self._silence.copy()

    def close(self) -> None:
        self._closed = True
        self._pending_blocks.clear()
        self._pending_sample_count = 0
        while not self._frames.empty():
            try:
                self._frames.get_nowait()
            except queue.Empty:
                break

    def _maybe_log_ingest_stats(self, block: Any) -> None:
        if getattr(block, "size", 0) == 0:
            return

        current_min = float(block.min())
        current_max = float(block.max())
        now = time.perf_counter()

        if self._ingest_stats_window_started_at is None:
            self._ingest_stats_window_started_at = now
            self._ingest_stats_min = current_min
            self._ingest_stats_max = current_max
            self._ingest_stats_blocks = 1
            return

        self._ingest_stats_min = current_min if self._ingest_stats_min is None else min(self._ingest_stats_min, current_min)
        self._ingest_stats_max = current_max if self._ingest_stats_max is None else max(self._ingest_stats_max, current_max)
        self._ingest_stats_blocks += 1

        if (now - self._ingest_stats_window_started_at) < WEBRTC_AUDIO_STATS_LOG_INTERVAL_SECONDS:
            return

        logger.info(
            "WebRTC audio ingest stats: min=%0.5f max=%0.5f blocks=%d queued_frames=%d",
            self._ingest_stats_min if self._ingest_stats_min is not None else 0.0,
            self._ingest_stats_max if self._ingest_stats_max is not None else 0.0,
            self._ingest_stats_blocks,
            self._frames.qsize(),
        )
        self._ingest_stats_window_started_at = now
        self._ingest_stats_min = None
        self._ingest_stats_max = None
        self._ingest_stats_blocks = 0

    def _normalize_to_stereo(self, spout: Any) -> Any:
        np = self._np
        raw = np.asarray(spout, dtype=np.float32)
        if raw.size == 0:
            return np.zeros((0, 2), dtype=np.float32)

        channels = max(1, int(self.source_channels))
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

    def _resample_block_linear(self, block: Any) -> Any:
        np = self._np
        in_samples = int(block.shape[0])
        if in_samples == 0:
            return block
        if in_samples == 1:
            return np.repeat(block, 1, axis=0)

        ratio = self.target_sample_rate / self.source_sample_rate
        out_samples = max(1, int(round(in_samples * ratio)))
        if out_samples == in_samples:
            return block

        src_x = np.arange(in_samples, dtype=np.float64)
        dst_x = np.linspace(0.0, float(in_samples - 1), num=out_samples, endpoint=True, dtype=np.float64)
        left = np.interp(dst_x, src_x, block[:, 0].astype(np.float64, copy=False)).astype(np.float32)
        right = np.interp(dst_x, src_x, block[:, 1].astype(np.float64, copy=False)).astype(np.float32)
        return np.stack([left, right], axis=1)

    def _pop_pending(self, sample_count: int) -> Any:
        np = self._np
        remaining = sample_count
        chunks: list[Any] = []

        while remaining > 0 and self._pending_blocks:
            head = self._pending_blocks[0]
            head_samples = int(head.shape[0])
            if head_samples <= remaining:
                chunks.append(head)
                self._pending_blocks.pop(0)
                self._pending_sample_count -= head_samples
                remaining -= head_samples
                continue

            chunks.append(head[:remaining].copy())
            self._pending_blocks[0] = head[remaining:]
            self._pending_sample_count -= remaining
            remaining = 0

        if not chunks:
            return np.zeros((sample_count, 2), dtype=np.float32)
        if len(chunks) == 1 and int(chunks[0].shape[0]) == sample_count:
            return chunks[0]

        merged = np.concatenate(chunks, axis=0)
        if int(merged.shape[0]) < sample_count:
            pad = np.zeros((sample_count - int(merged.shape[0]), 2), dtype=np.float32)
            merged = np.concatenate([merged, pad], axis=0)
        return merged

    def _enqueue_frame(self, frame_block: Any) -> None:
        try:
            self._frames.put_nowait(frame_block)
            return
        except queue.Full:
            pass

        try:
            self._frames.get_nowait()
        except queue.Empty:
            pass

        try:
            self._frames.put_nowait(frame_block)
        except queue.Full:
            # Drop when the consumer is too slow; realtime continuity is more important than backpressure.
            pass


class CsoundWebRtcAudioBridge:
    def __init__(
        self,
        frame_buffer: CsoundAudioFrameBuffer,
        *,
        ice_servers: list[dict[str, Any]] | None = None,
    ) -> None:
        self._frame_buffer = frame_buffer
        self._ice_servers = [dict(server) for server in (ice_servers or [])]
        self._peer_connection: Any = None
        self._lock = asyncio.Lock()

    @property
    def sample_rate(self) -> int:
        return self._frame_buffer.target_sample_rate

    def push_csound_block(self, spout: Any) -> None:
        self._frame_buffer.push_csound_block(spout)

    async def create_answer(self, *, offer_sdp: str, offer_type: str) -> tuple[str, str]:
        if offer_type != "offer":
            raise ValueError("WebRTC negotiation requires an SDP offer.")

        pc, outbound_track = await self._build_peer_connection()

        async with self._lock:
            if self._peer_connection is not None:
                await self._peer_connection.close()
            self._peer_connection = pc

        from aiortc import RTCSessionDescription  # type: ignore

        await pc.setRemoteDescription(RTCSessionDescription(sdp=offer_sdp, type=offer_type))
        pc.addTrack(outbound_track)
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await _wait_for_ice_gathering_complete(pc)

        local = pc.localDescription
        if local is None:
            raise RuntimeError("WebRTC local description was not created.")
        return local.sdp, local.type

    async def close(self) -> None:
        async with self._lock:
            pc = self._peer_connection
            self._peer_connection = None
        if pc is not None:
            await pc.close()
        self._frame_buffer.close()

    async def _build_peer_connection(self) -> tuple[Any, Any]:
        try:
            import av  # type: ignore
            from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection  # type: ignore
            from aiortc.mediastreams import AudioStreamTrack  # type: ignore
        except Exception as exc:
            raise RuntimeError(
                "WebRTC streaming dependencies are unavailable. Install the 'streaming' extras "
                "(aiortc / av) to use VISUALCSOUND_AUDIO_OUTPUT_MODE=streaming."
            ) from exc

        frame_buffer = self._frame_buffer

        class QueueAudioTrack(AudioStreamTrack):
            kind = "audio"

            def __init__(self) -> None:
                super().__init__()
                self._timestamp = 0
                self._started_at: float | None = None
                self._recv_started_logged = False
                self._stats_window_started_at: float | None = None
                self._stats_min: float | None = None
                self._stats_max: float | None = None
                self._stats_frames = 0

            def _maybe_log_stream_stats(self, pcm: Any) -> None:
                if getattr(pcm, "size", 0) == 0:
                    return

                current_min = float(pcm.min())
                current_max = float(pcm.max())
                now = time.perf_counter()

                if self._stats_window_started_at is None:
                    self._stats_window_started_at = now
                    self._stats_min = current_min
                    self._stats_max = current_max
                    self._stats_frames = 1
                    return

                self._stats_min = current_min if self._stats_min is None else min(self._stats_min, current_min)
                self._stats_max = current_max if self._stats_max is None else max(self._stats_max, current_max)
                self._stats_frames += 1

                if (now - self._stats_window_started_at) < WEBRTC_AUDIO_STATS_LOG_INTERVAL_SECONDS:
                    return

                logger.info(
                    "WebRTC audio buffer stats: min=%0.5f max=%0.5f frames=%d",
                    self._stats_min if self._stats_min is not None else 0.0,
                    self._stats_max if self._stats_max is not None else 0.0,
                    self._stats_frames,
                )
                self._stats_window_started_at = now
                self._stats_min = None
                self._stats_max = None
                self._stats_frames = 0

            async def recv(self):  # type: ignore[override]
                np = frame_buffer._np
                if not self._recv_started_logged:
                    logger.info("WebRTC audio track recv loop started")
                    self._recv_started_logged = True
                now = time.perf_counter()
                if self._started_at is None:
                    self._started_at = now
                else:
                    target_time = self._started_at + (self._timestamp / frame_buffer.target_sample_rate)
                    delay = target_time - now
                    if delay > 0:
                        await asyncio.sleep(delay)

                block = await asyncio.to_thread(frame_buffer.read_frame, 1.0)
                if int(block.shape[0]) != frame_buffer.frame_samples:
                    padded = np.zeros((frame_buffer.frame_samples, 2), dtype=np.float32)
                    count = min(frame_buffer.frame_samples, int(block.shape[0]))
                    if count > 0:
                        padded[:count] = block[:count]
                    block = padded

                pcm = np.clip(block, -1.0, 1.0)
                self._maybe_log_stream_stats(pcm)
                pcm_i16 = np.ascontiguousarray((pcm * 32767.0).astype(np.int16, copy=False))

                # aiortc's Opus encoder expects packed signed 16-bit PCM ("s16").
                # Build a packed stereo frame and write interleaved L/R samples.
                frame = av.AudioFrame(format="s16", layout="stereo", samples=frame_buffer.frame_samples)
                frame.planes[0].update(pcm_i16.tobytes())
                frame.sample_rate = frame_buffer.target_sample_rate
                frame.time_base = Fraction(1, frame_buffer.target_sample_rate)
                frame.pts = self._timestamp
                self._timestamp += frame_buffer.frame_samples
                return frame

        rtc_configuration = _build_aiortc_rtc_configuration(
            RTCConfiguration=RTCConfiguration,
            RTCIceServer=RTCIceServer,
            ice_servers=self._ice_servers,
        )
        pc = RTCPeerConnection(configuration=rtc_configuration)

        @pc.on("connectionstatechange")
        async def _on_connection_state_change() -> None:
            logger.info("WebRTC connection state changed: %s", pc.connectionState)
            if pc.connectionState in {"failed", "disconnected"}:
                await pc.close()

        return pc, QueueAudioTrack()


def _build_aiortc_rtc_configuration(*, RTCConfiguration: Any, RTCIceServer: Any, ice_servers: list[dict[str, Any]]) -> Any:
    if not ice_servers:
        return None

    configured_servers: list[Any] = []
    for index, server in enumerate(ice_servers):
        urls = server.get("urls")
        if not isinstance(urls, str) and not (
            isinstance(urls, list) and urls and all(isinstance(url, str) and url for url in urls)
        ):
            logger.warning("Ignoring invalid WebRTC ICE server config at index %s (missing urls)", index)
            continue

        kwargs: dict[str, Any] = {"urls": urls}
        username = server.get("username")
        credential = server.get("credential")
        if isinstance(username, str) and username:
            kwargs["username"] = username
        if isinstance(credential, str) and credential:
            kwargs["credential"] = credential

        configured_servers.append(RTCIceServer(**kwargs))

    if not configured_servers:
        return None
    return RTCConfiguration(iceServers=configured_servers)


async def _wait_for_ice_gathering_complete(pc: Any, timeout_seconds: float = 5.0) -> None:
    if getattr(pc, "iceGatheringState", None) == "complete":
        return

    completed = asyncio.Event()

    @pc.on("icegatheringstatechange")
    def _on_ice_gathering_state_change() -> None:
        if getattr(pc, "iceGatheringState", None) == "complete":
            completed.set()

    try:
        await asyncio.wait_for(completed.wait(), timeout=timeout_seconds)
    except TimeoutError:
        logger.warning("Timed out waiting for ICE gathering to complete; returning current local description.")
