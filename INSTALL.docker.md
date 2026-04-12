# Orchestron Installation Manual (Docker)

This guide runs Orchestron in Docker using the unified browser-clock runtime.

## 1. Prerequisites

Install:

- Docker Engine with Docker Compose support, or Docker Desktop
- Rust toolchain on the Docker host only if you want to run `host-midi-helper` for external MIDI devices

Confirm Docker is available:

```bash
docker --version
docker compose version
```

Optional host-side Rust install examples:

- macOS: `brew install rust`
- Linux: `curl https://sh.rustup.rs -sSf | sh -s -- -y`
- Windows: `winget install Rustlang.Rustup`

## 2. Get the source

If you already have the repository, skip this section.

```bash
git clone https://github.com/thomassresearch/orchestron.git Orchestron
cd Orchestron
```

## 3. Create the persistent Docker volume

The Compose setup uses an external volume for persistent `backend/data` storage.

```bash
docker volume create orchestron_data
```

## 4. Start the Docker stack

Run the backend in browser-clock mode with Docker Compose:

```bash
export VISUALCSOUND_HOST_MIDI_TOKEN=dev-midi-token
docker compose up --build
```

PowerShell equivalent:

```powershell
$env:VISUALCSOUND_HOST_MIDI_TOKEN = "dev-midi-token"
docker compose up --build
```

## 5. Open the application

After startup, open:

- Backend API: `http://localhost:8000`
- Backend-served frontend: `http://localhost:8000/client`

The Compose setup runs Csound in `browser_clock` mode. The browser owns the PCM queue through `AudioContext` + `AudioWorklet`, and the backend renders Csound blocks on demand over a controller WebSocket. The Config page exposes the main browser-clock latency controls whenever this runtime mode is active.

For localhost and LAN browser connections, the browser-clock client uses a low-latency queue profile with smaller render chunks and an urgent render request after live note-on events. This improves realtime piano-keyboard response compared with the older conservative buffering defaults.

Internal sequencers, piano rolls, and controller lanes work in Docker even when no OS MIDI devices exist.

If you want external hardware or DAW MIDI:

1. Keep the backend container running with `VISUALCSOUND_HOST_MIDI_TOKEN` set.
2. Run `host-midi-helper` on the Docker host, not in the container.
3. Point the helper at the published backend websocket:

```bash
VISUALCSOUND_HOST_MIDI_TOKEN=dev-midi-token \
cargo run --manifest-path host-midi-helper/Cargo.toml -- \
  --backend-ws ws://127.0.0.1:8000/ws/host-midi
```

4. Route your DAW or MIDI device into the host OS MIDI API that the helper can see.
5. In Orchestron, bind the helper-published input in the Runtime panel.

Because the helper runs on the host, this works even when the container itself has no direct MIDI device access.

## 6. Stop the stack

When you are done:

```bash
docker compose down
```

## 7. Additional notes

For implementation details and latency tuning, see [Browser-Clock Latency](documentation/configuration/browser_clock_latency.md).

If you do not need external MIDI hardware or DAW routing, you can ignore Rust entirely. The internal `internal:loopback` path still supports sequencers, piano rolls, and manual controller lanes inside the containerized app.
