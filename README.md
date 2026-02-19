# VisualCSound

VisualCSound is a 2-tier application for visual CSound instrument authoring.

- Backend: FastAPI + CSound Python integration
- Frontend: React + TypeScript + Tailwind + Rete.js

## Quick Start

### Backend

```bash
uv pip install -e '.[dev]'
uvicorn backend.app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend Serving Built Frontend

Build frontend once, then serve it from the backend at `/client`:

```bash
cd frontend
npm install
npm run build
cd ..
uvicorn backend.app.main:app --reload
```

Default backend URL: `http://localhost:8000`
Default frontend URL: `http://localhost:5173`
Backend-served frontend URL: `http://localhost:8000/client`

## MIDI on macOS

Enable the **IAC Driver** in Audio MIDI Setup and route MIDI output from your DAW/software into the selected IAC bus.

## MIDI Pulse CLI (jitter probe)

This repository includes a native macOS MIDI pulse emitter to help isolate timing jitter outside the main app/Csound path.

Build:

```bash
make midi-pulse-build
```

List MIDI destinations:

```bash
./tools/midi_pulse --list
```

Send periodic notes:

```bash
./tools/midi_pulse --dest 0 --channel 1 --note 60 --interval-ms 10 --gate 0.25 --count 2000
```

Useful flags:
- `--dest <name|index>`: destination by index (from `--list`) or name
- `--report-every <N>`: periodic timing summary in milliseconds
- `--verbose`: per-note lateness output
