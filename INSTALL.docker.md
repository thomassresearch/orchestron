# Orchestron Installation Manual (Docker)

This guide runs Orchestron in Docker using browser-audio streaming over WebRTC.

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

Run the backend in browser-audio streaming mode with Docker Compose:

```bash
docker compose up --build
```

## 5. Open the application

After startup, open:

- Backend API: `http://localhost:8000`
- Backend-served frontend: `http://localhost:8000/client`

The Compose setup runs Csound in `streaming` mode and sends audio to the browser over WebRTC using the bundled TURN service.

## 6. Stop the stack

When you are done:

```bash
docker compose down
```

## 7. Additional notes

For implementation details, latency tuning, and Docker-specific WebRTC notes, see [WEBRTC_STREAMING.md](WEBRTC_STREAMING.md).
