# VisualCSound Installation Manual (macOS)

This guide installs and runs VisualCSound on macOS with realtime CSound + MIDI support.

## 1. Prerequisites

Install required tools with Homebrew:

```bash
brew install uv node csound
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

## 2. Get the source

If you already have the repository, skip this section.

```bash
git clone <your-repo-url> VisualCSound
cd VisualCSound
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

## 7. MIDI setup on macOS (IAC Driver)

For loopback MIDI from DAWs/apps into VisualCSound:

1. Open **Audio MIDI Setup**.
2. Open **MIDI Studio** (Window -> Show MIDI Studio).
3. Open **IAC Driver**.
4. Enable **Device is online**.
5. Add/select a bus (for example `IAC Driver Bus 1`).
6. In your DAW, route MIDI output to that IAC bus.

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

### No MIDI outputs available
- Enable IAC Driver bus in Audio MIDI Setup.
- Restart backend and browser after changing MIDI device config.

## 10. Standalone MIDI jitter probe (macOS)

Use the native CLI probe when you want to verify timing behavior independent of the main VisualCSound runtime path.

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
