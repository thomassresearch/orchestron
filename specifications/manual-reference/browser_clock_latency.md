# Browser Clock Latency — Technical Background

Technical material retained during the manual reorganization. Historical version numbers describe the source snapshot, not the current support matrix. Consult [AGENTS.md](../../AGENTS.md) and its linked source contracts when changing behavior.

The backend suppresses Csound performance-time logging by default in headless browser-clock sessions. This
prevents stdout or Docker logging I/O from delaying `performKsmps()`. To diagnose Csound's own runtime messages,
start the backend with `VISUALCSOUND_CSOUND_PERFORMANCE_LOGGING=true`; this is intended as a temporary diagnostic
setting rather than a latency control.

Browser-clock manual MIDI is bounded on the backend even when events are routed through an arpeggiator. Deployments can tune the maximum accepted future timestamp with `VISUALCSOUND_BROWSER_CLOCK_MANUAL_MIDI_MAX_FUTURE_MS`, the accepted manual MIDI rate with `VISUALCSOUND_BROWSER_CLOCK_MANUAL_MIDI_RATE_PER_SECOND` and `VISUALCSOUND_BROWSER_CLOCK_MANUAL_MIDI_BURST`, and the per-session arpeggiator pending input cap with `VISUALCSOUND_ARPEGGIATOR_PENDING_INPUT_MAX_EVENTS`.

Runtime sessions allocate backend Csound worker resources, so session creation and live session-event observers are also bounded. `VISUALCSOUND_SESSION_MAX_ACTIVE` limits total active sessions, `VISUALCSOUND_SESSION_MAX_ACTIVE_PER_CLIENT` limits sessions owned by one client address, `VISUALCSOUND_SESSION_CREATE_RATE_PER_MINUTE` and `VISUALCSOUND_SESSION_CREATE_RATE_BURST` limit repeated creation attempts, and `VISUALCSOUND_SESSION_IDLE_TIMEOUT_SECONDS` deletes stopped idle sessions so capacity is returned automatically. Session event WebSocket observers are capped with `VISUALCSOUND_SESSION_EVENT_WS_MAX_SUBSCRIPTIONS_TOTAL` and `VISUALCSOUND_SESSION_EVENT_WS_MAX_SUBSCRIPTIONS_PER_SESSION`, while connection attempts are rate-limited with `VISUALCSOUND_SESSION_EVENT_WS_CONNECT_RATE_PER_MINUTE` and `VISUALCSOUND_SESSION_EVENT_WS_CONNECT_RATE_BURST`.

<a id="manual-midi-safety-limits"></a>

<a id="session-resource-limits"></a>

| Mode | Behavior |
| --- | --- |
| Auto | Uses Listening while idle. Starting a piano keyboard or manual MIDI controller, playing notes, moving a manual MIDI control, or receiving external notes/CCs selects Live. |
| Live | Always uses the configured Live queue targets and render limits, regardless of input activity. Select this before playing if the first note must be responsive. |
| Listening | Keeps a larger queue for listening to a performance, even when manual input arrives. |

**Switching preserves all queued audio, pending renders and transport position.** The worker
lets the existing queue drain when changing to Live and replenishes it when changing to Listening.
The indicator shows **Switching to Live** while the larger queue is draining. This means the first
unexpected note after Listening may still have the previous latency. No samples are skipped to
make the switch appear instantaneous. The AudioContext remains running with its interactive latency hint.

- `docker compose up --build`
- environment variable `VISUALCSOUND_AUDIO_OUTPUT_MODE=browser_clock`

- the backend renders PCM blocks on demand
- a dedicated browser audio worker keeps the target queue of decoded PCM and requests more audio
- the AudioWorklet consumes that queue independently of React rendering

The queue producer no longer runs on the React/main thread. Main-thread stalls can delay visual updates,
but they do not stop the worker from requesting or buffering PCM. Playback starts only after the startup
high-water target is reached. The Runtime panel reports current queued and pending-render milliseconds,
underrun/overrun counts, and the latest backend render-time/audio-time ratio.

- `Underrun Recovery Boost` adds extra queue headroom after an underrun is detected.
- `Max Underrun Boost` limits how large that temporary recovery buffer may grow.

- `Max Blocks Per Request` limits how much audio the browser asks for in one render request.
- `Steady Parallel Requests`, `Startup Parallel Requests`, and `Recovery Parallel Requests` control how many render requests may stay in flight in each state.

- `Immediate Note Render Blocks` sends a small urgent render burst after a live note-on event.
- `Immediate Note Render Cooldown` limits how often those urgent note-triggered bursts may happen.
