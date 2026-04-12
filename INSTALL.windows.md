# Orchestron Installation Manual (Windows)

This guide installs and runs Orchestron on Windows with the unified browser-clock runtime and optional native host MIDI bridge support.

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
- Visual Studio Build Tools or Visual Studio with `Desktop development with C++` is not required for the default browser-clock audio path. Install it only if a native dependency such as `ctcsound` or an optional legacy MIDI package needs to build from source on your machine.
- Set environment variables for Csound: make sure csound.exe is in the Path, and set the path to the opcode DLL's:
  - $env:Path = $env:Path + ";C:\....\Csound-6.18.1-windows-x64-binaries\build\Release"
  - $env:OPCODE6DIR = "C:\....\Csound-6.18.1-windows-x64-binaries\build\Release" 
  - $env:OPCODE6DIR64 = "C:\....\Csound-6.18.1-windows-x64-binaries\build\Release" 

Confirm the installed tools in a new PowerShell window:

```powershell
uv --version
node --version
npm --version
csound --version
```

Project requirements:
- Python `>= 3.13,< 3.14` is the project target (3.14 had issues on Windows because of a pre-release build)
- Node + npm (Node 20+ recommended)
- Csound runtime (for realtime synthesis via `ctcsound`)
- Rust toolchain (`cargo`) only if you want to run `host-midi-helper` for external MIDI devices

Optional Rust install for the helper:

```powershell
winget install Rustlang.Rustup
```

## 2. Get the source

If you already have the repository, skip this section.

```powershell
git clone <your-repo-url> Orchestron
Set-Location Orchestron
```

## 3. Install backend dependencies

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

## 7. MIDI setup on Windows (loopMIDI + host bridge)

Internal sequencers, piano rolls, and controller lanes work immediately through VisualCSound's built-in `internal:loopback` path and do not need any Windows MIDI device.

For external DAW/app MIDI into VisualCSound:

1. Install and start [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html).
2. Create a virtual port, for example `Orchestron Loopback`.
3. Start the backend with a host bridge token:

```powershell
$env:VISUALCSOUND_HOST_MIDI_TOKEN = "dev-midi-token"
uv run uvicorn backend.app.main:app --reload
```

4. In a second terminal, run the Rust host bridge against `ws://127.0.0.1:8000/ws/host-midi` with the same token:

```powershell
$env:VISUALCSOUND_HOST_MIDI_TOKEN = "dev-midi-token"
cargo run --manifest-path host-midi-helper/Cargo.toml -- --backend-ws ws://127.0.0.1:8000/ws/host-midi
```
5. Route your DAW or other MIDI app output to that loopMIDI port.
6. In Orchestron, open Instrument Design and bind that helper-provided input in the Runtime panel `MIDI Input` dropdown.

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
- Install Visual Studio Build Tools with `Desktop development with C++` only if `ctcsound` or another native extension needs to compile from source on your machine.
- Reinstall the Python bindings from the project environment:

```powershell
.\.venv\Scripts\Activate.ps1
uv pip install --force-reinstall ctcsound mido
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

- Internal app MIDI still works through `internal:loopback`.
- Start loopMIDI before starting the helper.
- Confirm at least one loopMIDI port exists.
- Confirm the backend and helper use the same `VISUALCSOUND_HOST_MIDI_TOKEN`.
- Restart the helper after changing Windows MIDI device or loopMIDI configuration.
- If you specifically need the legacy native `mido` backend, install `python-rtmidi` separately after the base setup; it is no longer required for the default Python 3.13 environment.

### PowerShell blocks `Activate.ps1`

- Run all backend commands with `uv run ...`, or allow local activation scripts for your user profile:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 10. Windows-specific notes

- The repo's `make` shortcuts are aimed at Unix-like shells. On Windows, use the direct `npm` and `uv` commands shown above instead of installing `make`.
- You do not need Chocolatey, `nvm-windows`, or a global `vite` install just to run this project.
- The project now targets Python 3.13 across platforms to avoid Python 3.14 pre-release/alpha resolver issues on Windows.
