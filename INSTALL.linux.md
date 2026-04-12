# Orchestron Installation Manual (Linux)

This guide installs and runs Orchestron on Linux with the unified browser-clock runtime and optional native host MIDI bridge support.

## 1. Prerequisites

Install required tools (Debian/Ubuntu example; adjust package names for your distro):

```bash
sudo apt update
sudo apt install -y nodejs npm alsa-utils
sudo apt install -y --no-install-recommends \
  csound \
  build-essential \
  pkg-config \
  cmake \
  libasound2-dev \
  libjack-jackd2-dev
curl -LsSf https://astral.sh/uv/install.sh | sudo env UV_INSTALL_DIR=/usr/local/bin sh
```

Optional for external MIDI through `host-midi-helper`:

```bash
curl https://sh.rustup.rs -sSf | sh -s -- -y
source "$HOME/.cargo/env"
```

Confirm versions:

```bash
uv --version
node --version
npm --version
csound --version
```

Project requirements:
- Python `>= 3.13,< 3.14`
- Node + npm (Node 20+ recommended)
- Csound runtime (for realtime synthesis via `ctcsound`)
- ALSA sequencer support (`/dev/snd/seq`) if you later choose to use native `mido` MIDI device discovery
- Rust toolchain (`cargo`) only if you want to run `host-midi-helper` for external MIDI devices

The backend can still start with a mock engine if `ctcsound` is not available, but realtime audio synthesis will be disabled.

## 2. Get the source

If you already have the repository, skip this section.

```bash
git clone https://github.com/thomassresearch/orchestron.git Orchestron
cd Orchestron
```

## 3. Install backend dependencies

Create a Python 3.13 environment and sync backend dependencies:

```bash
uv python install 3.13
uv sync --extra dev
source .venv/bin/activate
```

## 4. Install frontend dependencies

```bash
cd frontend
npm ci
cd ..
```

## 5. Recommended run mode (single URL)

Build the frontend once, then serve it from FastAPI at `/client`.

```bash
cd frontend
npm run build
cd ..
uv run uvicorn backend.app.main:app --reload
```

Open:
- API health: `http://localhost:8000/api/health`
- App UI: `http://localhost:8000/client`

## 6. Optional dev mode (separate frontend + backend)

Use this mode if you want Vite hot reload.

Start backend:

```bash
uv run uvicorn backend.app.main:app --reload
```

In a second terminal:

```bash
cd frontend
cat > .env.local << 'EOF'
VITE_API_BASE=http://localhost:8000/api
VITE_BACKEND_BASE=http://localhost:8000
VITE_WS_BASE=ws://localhost:8000
EOF
npm run dev
```

Open:
- Frontend dev server: `http://localhost:5173`
- Backend API: `http://localhost:8000`

## 7. MIDI setup on Linux (ALSA/JACK + host bridge)

Internal sequencers, piano rolls, and controller lanes work immediately through VisualCSound's built-in `internal:loopback` path and do not need any ALSA or JACK device.

For external DAW/controller MIDI into VisualCSound:

1. Confirm the ALSA sequencer device exists: `ls -l /dev/snd/seq`
2. List available MIDI ports: `aconnect -l`
3. If you use JACK, enable the JACK/ALSA bridge before starting the helper.
4. Start the backend with a host bridge token:

```bash
VISUALCSOUND_HOST_MIDI_TOKEN=dev-midi-token uv run uvicorn backend.app.main:app --reload
```

5. In a second terminal, run the host bridge:

```bash
cargo run --manifest-path host-midi-helper/Cargo.toml -- \
  --backend-ws ws://127.0.0.1:8000/ws/host-midi \
  --token dev-midi-token
```

6. Route your DAW or controller output to an ALSA MIDI input exposed by the helper.
7. In the Runtime panel, bind the desired helper-provided MIDI input for the active session.

## 8. Verification checklist

After startup, verify:

```bash
curl http://localhost:8000/api/health
curl http://localhost:8000/api/health/realtime
```

Expected: JSON responses with `"status": "ok"`.

## 9. Troubleshooting

### `ctcsound not available; using mock realtime engine`
- Ensure Csound is installed (`csound --version` works).
- Reinstall Python bindings:

```bash
uv pip install --force-reinstall ctcsound mido
```

### `/client` returns frontend build not found
Build frontend first:

```bash
cd frontend && npm run build
```

### Frontend dev mode cannot reach API/icons/websocket
- Ensure `frontend/.env.local` contains:
  - `VITE_API_BASE=http://localhost:8000/api`
  - `VITE_BACKEND_BASE=http://localhost:8000`
  - `VITE_WS_BASE=ws://localhost:8000`
- Restart `npm run dev` after editing `.env.local`.

### No MIDI inputs available on Linux
- Internal app MIDI still works through `internal:loopback`.
- Ensure `/dev/snd/seq` exists and is accessible.
- Install `alsa-utils`, then confirm MIDI devices appear in `aconnect -l`.
- Confirm the backend and helper use the same `VISUALCSOUND_HOST_MIDI_TOKEN`.
- Reconnect the device or recreate the virtual ALSA/JACK MIDI route, then restart the helper.

## 10. Linux-specific notes

- `make` is an optional shortcut for `cd frontend && npm run build`.
- `make run` is an optional shortcut for `uv run uvicorn backend.app.main:app --reload --log-level error --no-access-log`.
- `make midi-pulse-build` / `make midi-stats-build` are macOS-specific (`CoreMIDI`/`CoreFoundation`) and will not build on Linux as-is.
