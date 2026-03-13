# Clock Owners In VisualCSound

This document explains which component "drives the clock" in each part of the app, in both runtime modes:

- `local`: Csound outputs to the host audio device
- `streaming`: Csound runs headless in the backend and audio is streamed to the browser via WebRTC

It is based on the current implementation in `frontend/src` and `backend/app`.

## Short Summary

There is not one global clock. The app uses several clocks:

- The backend sequencer thread is the authoritative transport clock for melodic sequencer tracks and drummer tracks.
- The frontend is the clock owner for controller sequencers and piano-roll/direct-play interactions.
- Csound is the clock owner for continuous sound generation once a note is active.
- In streaming mode, WebRTC and the browser audio subsystem add an output/playback clock on top of Csound.

## Main Components

- Frontend React app: edits performances, starts/stops runtime, sends direct MIDI events, mirrors runtime state.
- Backend session service: owns runtime sessions, starts Csound, exposes sequencer and MIDI APIs.
- Backend sequencer runtime: emits timed MIDI note events for melodic and drummer tracks.
- Csound engine: turns MIDI and internal DSP graph logic into continuous audio.
- WebRTC bridge: only in streaming mode, packages backend audio for browser playback.

## 1. Session Startup

When instruments are started:

1. The frontend creates or reuses a backend session.
2. The backend compiles the selected patch assignments into a Csound orchestra.
3. Each assigned patch becomes its own Csound instrument number.
4. MIDI channel routing is established with `massign`.
5. Csound is started either in `local` or `streaming` audio mode.

Important consequence:

- The frontend does not synthesize audio.
- The frontend does not run the main note sequencer clock.
- The backend owns the runtime session and the Csound process.

## 2. How Configured Patterns Become Sound

### Melodic sequencer tracks

The frontend stores the editable pattern state, but when playback starts it converts that state into a backend sequencer payload:

- BPM
- transport length
- loop range
- track enable state
- active and queued pads
- per-pad step data
- expanded chord notes
- MIDI channels

That payload is sent to the backend sequencer API. From that point on, timed note playback is driven by the backend, not by the frontend.

### Drummer sequencers

Drummer tracks are also converted by the frontend into backend runtime tracks. Internally, each drum row becomes its own backend runtime track, but all rows share the same transport and pad logic from the frontend model.

### Controller sequencers

These are different:

- They are not part of the backend timed note sequencer.
- The frontend computes controller-curve playback itself.
- The frontend samples the curve in a `requestAnimationFrame` loop and sends `control_change` MIDI events to the backend session.

So controller sequencers are frontend-clocked, not backend-clocked.

### Piano roll and direct play

Interactive piano roll notes and manual controller changes are also frontend-driven:

- user action happens in the browser
- frontend sends `/sessions/{id}/midi-event`
- backend forwards that MIDI into the running engine path

These are not scheduled by the backend sequencer transport.

## 3. Who Drives The Sequencer Clock?

## Melodic tracks and drummer tracks: backend

The backend `SessionSequencerRuntime` owns a dedicated thread. That thread:

- uses `time.perf_counter()`
- computes step duration as `60 / bpm / 4`
- waits until the next step deadline
- emits MIDI note on/off messages at those deadlines
- advances playhead, cycle, pad switching, queueing, and sync behavior

This makes the backend sequencer thread the authoritative transport clock for:

- melodic sequencer tracks
- drummer tracks
- pad switching and queued pad activation
- track enable/disable boundary behavior
- transport playhead and cycle state

The frontend only mirrors this state.

## Controller sequencers: frontend

Controller sequencers use a different timing model:

- the frontend takes a backend transport snapshot
- it stores an anchor `{ playhead, cycle, stepCount, bpm, timestamp }`
- then it estimates in-between transport position in the browser
- it samples controller curves at sub-step resolution
- it sends CC MIDI messages back to the backend

So the controller sequencer's effective playback clock is owned by the browser render loop.

This means the transport reference comes from the backend, but the actual CC emission timing is frontend-driven.

## UI playhead animation: frontend, but not authoritative

The frontend polls backend sequencer status roughly every 80 ms and also interpolates between updates for smoother display.

That UI timing is only presentation. It does not drive melodic or drummer note playback.

## 4. Who Drives MIDI Event Delivery?

## Backend sequencer MIDI

For melodic and drummer playback:

- backend sequencer thread decides when a step happens
- backend sequencer thread sends MIDI messages through `MidiService`

So the backend drives MIDI timing for those devices.

## Frontend direct MIDI

For piano roll, manual controller changes, and controller sequencers:

- frontend decides when to send the event
- backend accepts the event through the session MIDI API
- backend injects it into the engine path

So these MIDI events are frontend-timed.

## 5. Who Drives Continuous Sound?

Once a note reaches Csound, Csound owns continuous sound generation.

That includes:

- oscillator phase progression
- envelopes
- filters
- feedback and delay behavior
- audio-rate modulation
- control-rate opcode evaluation
- note lifetime inside the instrument

The sequencer only creates discrete MIDI events. It does not generate audio samples itself.

Continuous sound exists because Csound continues running its DSP engine between note events.

## 6. Local Mode

## Audio path

In `local` mode:

- Csound is started with realtime DAC output
- compiled Csound options include `-odac`
- Csound runs its normal realtime perform loop
- audio goes to the machine's local sound device path

## Clock ownership in local mode

### Sequencer transport

- driven by backend sequencer thread

### MIDI note emission for melodic/drummer tracks

- driven by backend sequencer thread

### Direct MIDI from piano roll / controller sequencers / manual controls

- driven by frontend

### Continuous DSP and sample generation

- driven by Csound's realtime engine clock

### Final audible pacing

- ultimately governed by the host audio device clock

So in local mode the audible end of the chain is anchored to the host sound device.

## Local mode flow

1. Frontend starts session and sequencer.
2. Backend sequencer thread emits MIDI note events on step boundaries.
3. MIDI reaches Csound through the local runtime MIDI path.
4. Csound instruments react using opcodes such as `cpsmidi`, `ampmidi`, `midictrl`, and `notnum`.
5. Csound continuously renders audio.
6. Host audio backend pulls that audio to the speakers.

## 7. Streaming Mode

## Audio path

In `streaming` mode:

- Csound is started headless with no direct DAC output
- the backend manually advances Csound block-by-block with `performKsmps()`
- each generated Csound output block is copied into a WebRTC frame buffer
- the WebRTC bridge packages frames for a browser audio track
- the browser receives and plays the stream

## MIDI path in streaming mode

Streaming mode is designed so container MIDI devices are not required.

Instead:

- the backend worker installs host-implemented MIDI callbacks into Csound
- direct MIDI can be written into an in-memory buffer
- Csound reads MIDI bytes from that buffer inside its own runtime

In the Docker-oriented setup, `MidiService` fallback delivery and the worker's virtual sink registration let backend sequencer notes and frontend direct MIDI both arrive through this internal path.

## Clock ownership in streaming mode

### Sequencer transport

- driven by backend sequencer thread

### MIDI note emission for melodic/drummer tracks

- driven by backend sequencer thread

### Direct MIDI from piano roll / controller sequencers / manual controls

- driven by frontend

### Csound DSP block progression

- driven by backend worker's streaming perform loop

The streaming worker computes block duration from:

- `block_seconds = ksmps / sr`

and sleeps to maintain that cadence while repeatedly calling `performKsmps()`.

### WebRTC frame pacing

- driven by the backend WebRTC track's frame timestamps

The WebRTC bridge reads from the audio frame buffer in fixed-size frames, typically 10 ms or 20 ms.

### Final audible playback

- driven by the browser / operating system audio playback clock

So streaming mode introduces one more layer than local mode: browser playback timing after backend audio generation.

## Streaming mode flow

1. Frontend starts the runtime session.
2. Backend starts Csound in headless streaming mode.
3. Backend sequencer thread emits MIDI note events.
4. MIDI is injected into Csound through host-implemented MIDI callbacks.
5. Backend worker advances Csound one `ksmps` block at a time.
6. Each output block is written into a WebRTC frame buffer.
7. Frontend negotiates a WebRTC connection.
8. Browser receives audio frames and plays them.

## 8. Csound's Role In Both Modes

Regardless of mode, Csound is where note events become sustained sound.

The compiled orchestra:

- defines global engine settings such as `sr`, `ksmps`, `nchnls`, and `0dbfs`
- maps MIDI channels to instrument numbers with `massign`
- generates per-patch `instr N` bodies
- uses MIDI opcodes inside those instrument bodies

That means the app's patterns do not directly produce waveforms. They produce MIDI events that trigger Csound instruments, and those instruments then run continuously until release or stop conditions occur.

## 9. Important Nuance: Controller Sequencers Are Separate

The biggest architectural nuance is this:

- note and drum sequencing are backend-clocked
- controller sequencing is frontend-clocked

The frontend tries to keep controller sequencers aligned by anchoring to backend transport state, but the CC messages themselves are emitted from the browser.

So if someone asks "who drives the clock?" the correct answer depends on which device they mean.

## 10. Final Answer By Component

### Frontend sequencer editor

- owns editable configuration
- does not own melodic/drummer playback timing

### Backend sequencer runtime

- owns melodic/drummer transport timing
- owns step advancement and timed note emission

### Piano roll

- frontend-owned event timing

### MIDI controller widgets

- frontend-owned event timing

### Controller sequencers

- frontend-owned event timing, backend-referenced transport

### Csound engine

- owns continuous DSP time
- owns sample generation once notes are active

### Host sound device in local mode

- owns final playback clock

### WebRTC bridge in streaming mode

- owns transport of rendered audio frames to the browser

### Browser audio playback in streaming mode

- owns final playback clock on the client side

## 11. Practical Mental Model

If you want the simplest internal model, use this:

- The backend decides when notes happen.
- The frontend decides when manual notes and controller curves happen.
- Csound decides how active notes evolve sample by sample.
- Local mode ends at the host sound card.
- Streaming mode ends at the browser audio output.

## 12. One Current Implementation Detail

The sequencer config includes `gate_ratio`, but the current backend sequencer runtime does not schedule a separate intra-step note-off based on that value.

In practice, notes are released when one of these happens:

- a new note replaces them
- a non-hold rest occurs
- a boundary action releases them
- transport stops

So the present runtime is more "step/boundary release driven" than "gate-time release driven."
