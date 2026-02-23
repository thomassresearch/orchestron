# WebRTC Streaming

This document explains how Orchestron streams audio to the browser via WebRTC and how to run that mode in Docker.

## Overview

Orchestron supports two audio output modes:

- `local`: Csound writes to a local realtime audio backend (`-odac`)
- `streaming`: Csound runs headless (`-n`) and audio is streamed to the browser over WebRTC

The Docker workflow is built around `streaming` mode because containerized local audio device passthrough is platform-specific (and not available on macOS Docker Desktop).

## How Streaming Is Implemented

### 1. Csound runs in headless streaming mode

When the backend starts with `--audio-output-mode streaming` (or `VISUALCSOUND_AUDIO_OUTPUT_MODE=streaming`), `CsoundWorker` starts Csound without local DAC output and drives audio generation in a `performKsmps()` loop.

Relevant code:

- `/Users/thuber/Projekte/VisualCSound/backend/app/engine/csound_worker.py`
- `/Users/thuber/Projekte/VisualCSound/backend/app/services/session_service.py`

### 2. Csound output blocks are converted into WebRTC audio frames

Each `performKsmps()` iteration reads `csound.spout()` and pushes the PCM block into `CsoundAudioFrameBuffer`, which:

- normalizes to stereo
- resamples to `48 kHz` (WebRTC target rate) when needed
- slices audio into fixed-size frames (`10 ms` or `20 ms`)
- stores frames in a bounded queue

The queue is intentionally trimmed to keep latency low. Stale frames are dropped instead of allowing backlog to grow indefinitely.

Relevant code:

- `/Users/thuber/Projekte/VisualCSound/backend/app/engine/webrtc_audio.py`

### 3. Backend creates a WebRTC answer (aiortc)

The backend exposes a negotiation endpoint. The frontend creates a `recvonly` audio `RTCPeerConnection` offer and sends it to the backend. The backend:

- creates an `aiortc` `RTCPeerConnection`
- adds an outbound audio track backed by the frame buffer
- returns an SDP answer

The audio track (`QueueAudioTrack`) paces outgoing audio using timestamps and can flush startup backlog when playback begins.

### 4. Frontend receives the audio stream

The browser creates a `RTCPeerConnection`, receives the remote audio track, and assigns the resulting `MediaStream` to an `<audio>` element for playback.

Relevant code:

- `/Users/thuber/Projekte/VisualCSound/frontend/src/App.tsx`

## Docker Architecture (Streaming Mode)

`/Users/thuber/Projekte/VisualCSound/docker-compose.yaml` runs two services:

- `coturn`: TURN server used for WebRTC ICE candidates
- `orchestron`: backend application container running in streaming mode

Why TURN is included:

- The browser runs on the host
- The backend runs inside Docker networking
- TURN provides a reliable path between them, especially on Docker Desktop

## Running in Docker

### Start the stack

```bash
docker compose up --build
```

This starts:

- the backend API on `http://localhost:8000`
- the backend-served frontend on `http://localhost:8000/client`
- TURN on `3478` (TCP/UDP)

### Use the app

1. Open `http://localhost:8000/client`.
2. Start a session/instrument as usual.
3. The backend runs Csound in streaming mode and the browser connects to the WebRTC audio stream automatically.

### Optional: use the Vite frontend during development

You can still run the frontend locally (outside Docker) on `http://localhost:5173` while using the Docker backend on `http://localhost:8000`.

The compose file already allows both origins via `VISUALCSOUND_CORS_ORIGINS`.

## Latency Tuning (Current Docker Defaults)

The compose file includes low-latency WebRTC queue settings:

- `VISUALCSOUND_WEBRTC_AUDIO_FRAME_MS=10`
- `VISUALCSOUND_WEBRTC_AUDIO_QUEUE_FRAMES_MAX=4`
- `VISUALCSOUND_WEBRTC_AUDIO_QUEUE_FRAMES_TARGET=2`
- `VISUALCSOUND_WEBRTC_AUDIO_FLUSH_ON_CONNECT=true`
- `VISUALCSOUND_WEBRTC_AUDIO_STARTUP_KEEP_FRAMES=1`

These settings reduce latency significantly but increase sensitivity to CPU scheduling jitter and network jitter. If you hear dropouts:

- switch frame size back to `20`
- increase queue sizes (for example max `8`, target `4`)

## TURN / ICE Notes

- Docker Desktop users may need to set `VISUALCSOUND_TURN_EXTERNAL_IP` to the host LAN IP when accessing the app from another device.
- For lowest latency, prefer UDP ICE candidates. TURN/TCP can increase latency.

## About `docker-compose.alsa.yaml`

The historical ALSA override is only useful for Linux audio device passthrough (`/dev/snd`) and local DAC-oriented container setups.

It is not required for browser WebRTC streaming mode, which is the mode used by `/Users/thuber/Projekte/VisualCSound/docker-compose.yaml`.
