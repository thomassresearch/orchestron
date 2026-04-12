# Host MIDI Helper

`host-midi-helper` is the native sidecar daemon for VisualCSound's host MIDI bridge.

It connects to the backend websocket at `/ws/host-midi`, authenticates with `VISUALCSOUND_HOST_MIDI_TOKEN`, publishes the host MIDI input inventory, and forwards inbound MIDI messages with helper-local monotonic timestamps.

## Why it exists

- The backend now runs in browser-clock mode on every platform.
- Internal app MIDI stays inside the session engine and does not need any OS MIDI device.
- External hardware or DAW MIDI needs a host-side process because Docker and browser-clock sessions cannot rely on direct backend access to every native MIDI API.

## Current behavior

- Enumerates host MIDI inputs with `midir`
- Re-scans inputs periodically and republishes inventory when devices change
- Opens each discovered input and forwards incoming MIDI bytes over the websocket bridge
- Sends periodic clock-sync messages so the backend can map helper timestamps into engine time

Timestamp quality is advertised as:

- `native` on macOS and Linux
- `best_effort` on Windows
- `immediate` on other platforms

## Build

```bash
cargo build --manifest-path host-midi-helper/Cargo.toml
```

## Run

Backend:

```bash
VISUALCSOUND_HOST_MIDI_TOKEN=dev-midi-token uv run uvicorn backend.app.main:app --reload
```

Helper:

```bash
VISUALCSOUND_HOST_MIDI_TOKEN=dev-midi-token \
cargo run --manifest-path host-midi-helper/Cargo.toml -- \
  --backend-ws ws://127.0.0.1:8000/ws/host-midi
```

## Notes

- Internal sequencers, piano rolls, and controller lanes do not depend on this helper.
- With no MIDI hardware attached, the helper simply publishes an empty inventory; the app still works through the internal loopback.
- Stable device ids are derived from the host id plus sanitized port names.
