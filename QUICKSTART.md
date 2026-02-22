# QUICKSTART (Fresh Linux Server)

## Requirements

Required to build/run the app on a fresh machine:

- `Node.js` + `npm` (Node 20+ recommended)
- Frontend dependencies installed (`cd frontend && npm ci` or `make frontend-install`)
- Python 3.14 available to `uv` (`pyproject.toml` requires `>=3.14`)
- Backend Python dependencies installed (`uv sync`)

Optional / runtime features (realtime audio + MIDI on Linux):

- `csound` runtime (used by `ctcsound`)
- ALSA MIDI support (`python-rtmidi`, default Linux MIDI backend is `alsaseq`)
- Build tools/dev headers if wheels are unavailable (e.g. `build-essential`, `python3-dev`, `libasound2-dev`)

The backend can still start with a **mock engine** if `ctcsound` is not available, but realtime audio synthesis will be disabled.

## Fresh Linux Setup (Debian/Ubuntu example)

Install system tools (adjust package names for your distro):

```bash
sudo apt update
sudo apt install -y nodejs npm
```

Optional realtime/audio dependencies:

```bash
sudo apt install -y csound libasound2-dev build-essential pkg-config python3-dev
```

## Project Setup

From the repository root:

```bash
uv python install 3.14
uv sync
make frontend-install   # runs: cd frontend && npm install
```

Prefer reproducible frontend installs (uses `frontend/package-lock.json`):

```bash
cd frontend && npm ci && cd ..
```

## Build and Run

Build frontend (this is what plain `make` does):

```bash
make
```

Run backend:

```bash
make run
```

Open:

- Backend API health: `http://localhost:8000/api/health`
- Backend-served frontend (after build): `http://localhost:8000/client`

## Minimal Working Command Sequence

```bash
uv python install 3.14
uv sync
cd frontend && npm ci && cd ..
make
make run
```

## Notes

- `make` does **not** run `uv sync` or `npm install`.
- `make test` requires backend test dependencies; if needed, use `uv sync --extra dev`.
- `make midi-pulse-build` / `make midi-stats-build` are macOS-specific (`CoreMIDI`/`CoreFoundation`) and will not build on Linux as-is.
