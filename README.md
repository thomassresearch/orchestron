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
