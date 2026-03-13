# Orchestron Installation Manual (Windows)

This guide installs and runs Orchestron on Windows with realtime Csound + MIDI support.

All commands below assume PowerShell.

## 1. Prerequisites

Install the required tools:

- `uv` for Python environment management:
Run the commands in an elevated powershell (with admin rights):

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

- Node.js + npm from [nodejs.org](https://nodejs.org/) or your preferred Windows package manager. Node 20+ is recommended.
- Csound from [csound.com/download.html](https://csound.com/download.html). After installation, ensure the directory containing `csound.exe` is on your `PATH`.
- Needed on Windows: Visual Studio Build Tools or Visual Studio with `Desktop development with C++` as the portaudio python package will need native compilation.

Confirm the installed tools in a new PowerShell window:

```powershell
uv --version
node --version
npm --version
csound --version
```

Project requirements:
- Python `>= 3.13,<3.14` # as 3.14 is currently ALPHA on windows, that will change, then 3.14 is fine
- Node + npm (Node 20+ recommended)
- Csound runtime (for realtime synthesis via `ctcsound`)

`uv python install 3.14` in section 3 installs the required Python version if it is not already available.

## 2. Get the source

If you already have the repository, skip this section.

```powershell
git clone <your-repo-url> Orchestron
Set-Location Orchestron
```

## 3. Install backend dependencies

Currently, python 3.14 is ALPHA on windows, did not work, so there is a hack required: edit pyproject.toml, and change line 6 from:
```
requires-python = ">=3.14"
```
to:
```
requires-python = ">=3.13,<3.14"

```


Then create the Python 3.13 environment and sync backend dependencies:

```powershell
uv python install 3.13
uv sync --extra dev
.\.venv\Scripts\Activate.ps1
```

The activation step is optional if you prefer running commands through `uv run`.

## 4. Install frontend dependencies

```powershell
Set-Location frontend
npm ci
Set-Location ..
```

## 5. Recommended run mode (single URL)

Build the frontend once, then serve it from FastAPI at `/client`.

```powershell
Set-Location frontend
npm run build
Set-Location ..
uv run uvicorn backend.app.main:app --reload
```

Open:
- API health: `http://localhost:8000/api/health`
- App UI: `http://localhost:8000/client`

## 6. Optional dev mode (separate frontend + backend)

Use this mode if you want Vite hot reload.

Start backend:

```powershell
uv run uvicorn backend.app.main:app --reload
```

In a second PowerShell window:

```powershell
Set-Location frontend
@"
VITE_API_BASE=http://localhost:8000/api
VITE_BACKEND_BASE=http://localhost:8000
VITE_WS_BASE=ws://localhost:8000
"@ | Set-Content .env.local
npm run dev
```

Open:
- Frontend dev server: `http://localhost:5173`
- Backend API: `http://localhost:8000`

## 7. MIDI setup on Windows (loopMIDI)

For loopback MIDI from within Orchestron mandatory:

1. Install and start [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html).
2. Create a virtual port, for example `Orchestron Loopback`.
3. Start Orchestron so the backend can enumerate available MIDI inputs.
4. Route your DAW or other MIDI app output to that loopMIDI port.
5. In Orchestron, open Instrument Design and select that input in the Runtime panel `MIDI Input` dropdown.

## 8. Verification checklist

After startup, verify:

```powershell
Invoke-RestMethod http://localhost:8000/api/health
Invoke-RestMethod http://localhost:8000/api/health/realtime
```

Expected: both responses include `status` with the value `ok`.

## 9. Troubleshooting

### `csound` is not recognized as a command

- Add the Csound installation directory containing `csound.exe` to your `PATH`.
- Open a new PowerShell window and rerun `csound --version`.

### `ctcsound not available; using mock realtime engine`

- Ensure Csound is installed and `csound --version` works.
- Install Visual Studio Build Tools with `Desktop development with C++` if native extensions need to compile.
- Reinstall the Python bindings from the project environment:

```powershell
.\.venv\Scripts\Activate.ps1
uv pip install --force-reinstall ctcsound python-rtmidi mido
```

### `/client` returns frontend build not found

Build the frontend first:

```powershell
Set-Location frontend
npm run build
Set-Location ..
```

### Frontend dev mode cannot reach API, icons, or websocket

- Ensure `frontend/.env.local` contains:
  - `VITE_API_BASE=http://localhost:8000/api`
  - `VITE_BACKEND_BASE=http://localhost:8000`
  - `VITE_WS_BASE=ws://localhost:8000`
- Restart `npm run dev` after editing `.env.local`.

### No MIDI inputs are available

- Start loopMIDI before starting the backend.
- Confirm at least one loopMIDI port exists.
- Restart the backend and browser after changing Windows MIDI device or loopMIDI configuration.

### PowerShell blocks `Activate.ps1`

- Run all backend commands with `uv run ...`, or allow local activation scripts for your user profile:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 10. Windows-specific notes

- The repo's `make` shortcuts are aimed at Unix-like shells. On Windows, use the direct `npm` and `uv` commands shown above instead of installing `make`.
- You do not need Chocolatey, `nvm-windows`, or a global `vite` install just to run this project.
- Do not edit `pyproject.toml` to force Python 3.13 unless you are debugging a specific dependency compatibility problem on your own machine. The project currently targets Python 3.14.
