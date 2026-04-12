# Orchestron Installation Manual (macOS)

This guide installs and runs Orchestron on macOS with the unified browser-clock runtime and optional native host MIDI bridge support.

## 1. Prerequisites

Install required tools with Homebrew:

```bash
brew install uv node csound
```

Optional for external MIDI through `host-midi-helper`:

```bash
brew install rust
```

Confirm versions:

```bash
uv --version
python3 --version
node --version
npm --version
csound --version
```

Project requirements:
- Python `>= 3.14`
- Node + npm (Node 20+ recommended)
- Csound runtime (for realtime synthesis via `ctcsound`)
- Rust toolchain (`cargo`) only if you want to run `host-midi-helper` for external MIDI devices

## 2. Get the source

If you already have the repository, skip this section.

```bash
git clone <your-repo-url> Orchestron
cd Orchestron
```

## 3. Install backend dependencies

Create and use a virtual environment with Python 3.14:

```bash
uv python install 3.14
uv venv --python 3.14
source .venv/bin/activate
```

Install backend package + dev dependencies:

```bash
uv pip install -e '.[dev]'
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

## 7. MIDI setup on macOS (IAC Driver + host bridge)

Internal sequencers, piano rolls, and controller lanes work immediately through VisualCSound's built-in `internal:loopback` path and do not need any macOS MIDI device.

For external DAW/app MIDI into VisualCSound:

1. Open **Audio MIDI Setup**.
2. Open **MIDI Studio** (Window -> Show MIDI Studio).
3. Open **IAC Driver**.
4. Enable **Device is online**.
5. Add/select a bus (for example `IAC Driver Bus 1`).
6. In your DAW, route MIDI output to that IAC bus.
7. Start the backend with a host bridge token:

```bash
VISUALCSOUND_HOST_MIDI_TOKEN=dev-midi-token uv run uvicorn backend.app.main:app --reload
```

8. In a second terminal, run the host bridge:

```bash
cargo run --manifest-path host-midi-helper/Cargo.toml -- \
  --backend-ws ws://127.0.0.1:8000/ws/host-midi \
  --token dev-midi-token
```

9. In the Runtime panel, bind the desired helper-provided MIDI input for the active session.

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
uv pip install --force-reinstall ctcsound python-rtmidi mido
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

### No external MIDI inputs available
- Internal app MIDI still works through `internal:loopback`.
- Enable the IAC Driver bus in Audio MIDI Setup.
- Confirm the backend and helper use the same `VISUALCSOUND_HOST_MIDI_TOKEN`.
- Restart the helper after changing macOS MIDI device configuration.

## 10. Standalone MIDI jitter probe (macOS)

Use the native CLI probe when you want to verify timing behavior independent of the main Orchestron runtime path.

Build:

```bash
make midi-pulse-build
```

List destinations:

```bash
./tools/midi_pulse --list
```

Run a high-rate timing test:

```bash
./tools/midi_pulse --dest 0 --channel 1 --interval-ms 5 --gate 0.2 --count 5000 --report-every 250
```

The utility prints note-on lateness stats (`mean`, `abs_mean`, `min`, `max`) in milliseconds so you can compare baseline sender jitter against Csound-integrated runs.

Receive-side stats probe:

```bash
make midi-stats-build
./tools/midi_stats --list
./tools/midi_stats --dest 0 --channel 1 --report-every 250
```

`midi_stats` listens to note-on events (velocity > 0) and prints interval/jitter aggregates every `--report-every` events.
