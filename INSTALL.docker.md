# Orchestron Installation Manual (Docker)

This guide runs Orchestron in Docker using the unified browser-clock runtime.

## 1. Prerequisites

Install:

- Docker Engine with Docker Compose support, or Docker Desktop

Confirm Docker is available:

```bash
docker --version
docker compose version
```

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
docker compose up --build
```

## 5. Open the application

After startup, open:

- Backend API: `http://localhost:8000`
- Backend-served frontend: `http://localhost:8000/client`

The Compose setup runs Csound in `browser_clock` mode. The browser owns the PCM queue through `AudioContext` + `AudioWorklet`, and the backend renders Csound blocks on demand over a controller WebSocket. The Config page exposes the main browser-clock latency controls whenever this runtime mode is active.

For localhost and LAN browser connections, the browser-clock client uses a low-latency queue profile with smaller render chunks and an urgent render request after live note-on events. This improves realtime piano-keyboard response compared with the older conservative buffering defaults.

Internal sequencers, piano rolls, and controller lanes work in Docker even when no OS MIDI devices exist. If you want external hardware or DAW MIDI, run `host-midi-helper` on the Docker host and point it at the backend websocket with the same `VISUALCSOUND_HOST_MIDI_TOKEN`.

## 6. Stop the stack

When you are done:

```bash
docker compose down
```

## 7. Additional notes

For implementation details and latency tuning, see [Browser-Clock Latency](documentation/configuration/browser_clock_latency.md).
