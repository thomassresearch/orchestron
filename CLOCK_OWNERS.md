# Clock Owners In VisualCSound

This document explains which component "drives the clock" in each part of the app, in both runtime modes:

- `local`: Csound outputs to the host audio device
- `browser_clock`: the browser owns PCM playback and requests render chunks from the backend

It is based on the current implementation in `frontend/src` and `backend/app`.

## Short Summary

There is not one global clock. The app uses several clocks:

- The backend sequencer thread is the authoritative transport clock for melodic sequencer tracks, drummer tracks, and controller sequencers.
- The frontend is the clock owner for piano-roll/direct-play interactions and manual controller gestures.
- Csound is the clock owner for continuous sound generation once a note is active.
- In browser-clock mode, the browser audio subsystem adds an output/playback clock on top of Csound.

## Main Components

- Frontend React app: edits performances, starts/stops runtime, sends direct MIDI events, mirrors runtime state.
- Backend session service: owns runtime sessions, starts Csound, exposes sequencer and MIDI APIs.
- Backend sequencer runtime: emits timed MIDI note and controller events for sequenced tracks.
- Csound engine: turns MIDI and internal DSP graph logic into continuous audio.
- Browser-clock controller: only in browser_clock mode, requests backend PCM renders and owns browser playback timing.

## 1. Session Startup

When instruments are started:

1. The frontend creates or reuses a backend session.
2. The backend compiles the selected patch assignments into a Csound orchestra.
3. Each assigned patch becomes its own Csound instrument number.
4. MIDI channel routing is established with `massign`.
5. Csound is started either in `local` or `browser_clock` audio mode.

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

Controller sequencers are also sent to the backend sequencer:

- The frontend sends controller timing, pad-loop state, pad lengths, controller number, and curve keypoints.
- The backend compiles those pads into controller automation events.
- The backend sequencer thread emits timed `control_change` MIDI messages.

So controller sequencers are backend-clocked, not frontend-clocked.

### Piano roll and direct play

Interactive piano roll notes and manual controller changes are also frontend-driven:

- user action happens in the browser
- frontend sends `/sessions/{id}/midi-event`
- backend forwards that MIDI into the running engine path

These are not scheduled by the backend sequencer transport.

## 3. Who Drives The Sequencer Clock?

## Melodic tracks, drummer tracks, and controller sequencers: backend

The backend `SessionSequencerRuntime` owns a dedicated thread. That thread:

- uses `time.perf_counter()`
- advances by transport subunits and local step spans
- waits until the next note or controller deadline
- emits MIDI note and controller messages at those deadlines
- advances playhead, cycle, pad switching, queueing, and sync behavior

This makes the backend sequencer thread the authoritative transport clock for:

- melodic sequencer tracks
- drummer tracks
- controller sequencers
- pad switching and queued pad activation
- track enable/disable boundary behavior
- transport playhead and cycle state

The frontend only mirrors this state.

## Controller sequencers: backend

Controller sequencers use a different timing model:

- the frontend sends controller pads and keypoints to the backend
- the backend compiles controller pads into transport-relative automation events
- the backend sequencer thread emits `control_change` MIDI messages
- the frontend mirrors runtime state such as `active_pad`, `queued_pad`, and `runtime_pad_start_subunit`

So the controller sequencer's effective playback clock is owned by the backend sequencer thread.

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

For piano roll and manual controller changes:

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

### Scheduled MIDI emission for melodic/drummer/controller tracks

- driven by backend sequencer thread

### Direct MIDI from piano roll / manual controls

- driven by frontend

### Continuous DSP and sample generation

- driven by Csound's realtime engine clock

### Final audible pacing

- ultimately governed by the host audio device clock

So in local mode the audible end of the chain is anchored to the host sound device.

## Local mode flow

1. Frontend starts session and sequencer.
2. Backend sequencer thread emits scheduled MIDI note and controller events.
3. MIDI reaches Csound through the local runtime MIDI path.
4. Csound instruments react using opcodes such as `cpsmidi`, `ampmidi`, `midictrl`, and `notnum`.
5. Csound continuously renders audio.
6. Host audio backend pulls that audio to the speakers.

## 7. Browser-Clock Mode

## Audio path

In `browser_clock` mode:

- Csound is started headless with no direct DAC output
- the browser becomes the playback clock and requests PCM render chunks over a controller WebSocket
- the backend manually advances Csound block-by-block with `performKsmps()`
- each generated Csound output block is returned to the browser as PCM bytes
- the browser owns the final playback timing through `AudioContext` + `AudioWorklet`

## MIDI path in browser_clock mode

Browser-clock mode is designed so container MIDI devices are not required.

Instead:

- the backend worker installs host-implemented MIDI callbacks into Csound
- direct MIDI can be written into an in-memory buffer
- Csound reads MIDI bytes from that buffer inside its own runtime

In the Docker-oriented setup, `MidiService` fallback delivery and the worker's virtual sink registration let backend sequencer notes and frontend direct MIDI both arrive through this internal path.

## Clock ownership in browser_clock mode

### Sequencer transport

- driven by backend sequencer thread

### Scheduled MIDI emission for melodic/drummer/controller tracks

- driven by backend sequencer thread

### Direct MIDI from piano roll / manual controls

- driven by frontend

### Csound DSP block progression

- driven by backend worker's browser-clock render loop

The browser-clock worker computes block duration from:

- `block_seconds = ksmps / sr`

and sleeps to maintain that cadence while repeatedly calling `performKsmps()`.

### Browser PCM request pacing

- driven by the browser controller's queue watermarks and render requests

The browser requests PCM in fixed-size render chunks, typically aligned to the current `ksmps` window.

### Final audible playback

- driven by the browser / operating system audio playback clock

So browser_clock mode introduces one more layer than local mode: browser playback timing after backend audio generation.

## Browser-clock flow

1. Frontend starts the runtime session.
2. Backend starts Csound in headless browser_clock mode.
3. Backend sequencer thread emits scheduled MIDI note and controller events.
4. MIDI is injected into Csound through host-implemented MIDI callbacks.
5. Backend worker advances Csound one `ksmps` block at a time when the browser requests render chunks.
6. Each output block is returned as PCM bytes to the browser controller.
7. The browser feeds the PCM into `AudioContext` + `AudioWorklet`.
8. Browser playback and sequencer display are derived from the browser clock.

## 8. Csound's Role In Both Modes

Regardless of mode, Csound is where note events become sustained sound.

The compiled orchestra:

- defines global engine settings such as `sr`, `ksmps`, `nchnls`, and `0dbfs`
- maps MIDI channels to instrument numbers with `massign`
- generates per-patch `instr N` bodies
- uses MIDI opcodes inside those instrument bodies

That means the app's patterns do not directly produce waveforms. They produce MIDI events that trigger Csound instruments, and those instruments then run continuously until release or stop conditions occur.

## 9. Important Nuance: Controller Sequencers Share The Backend Transport

The biggest architectural nuance is this:

- note and drum sequencing are backend-clocked
- controller sequencing is also backend-clocked
- piano roll and manual controller gestures remain frontend-clocked

So if someone asks "who drives the clock?" the correct answer depends on which device they mean.

## 10. Final Answer By Component

### Frontend sequencer editor

- owns editable configuration
- does not own melodic/drummer playback timing

### Backend sequencer runtime

- owns melodic/drummer/controller transport timing
- owns step advancement and timed MIDI emission

### Piano roll

- frontend-owned event timing

### MIDI controller widgets

- frontend-owned event timing

### Controller sequencers

- backend-owned event timing

### Csound engine

- owns continuous DSP time
- owns sample generation once notes are active

### Host sound device in local mode

- owns final playback clock

### Browser-clock controller in browser_clock mode

- owns transport of rendered audio chunks to the browser
- owns request pacing and playback timing on the client side

### Browser audio playback in browser_clock mode

- owns final playback clock on the client side

## 11. Practical Mental Model

If you want the simplest internal model, use this:

- The backend decides when notes happen.
- The backend decides when controller curves happen.
- The frontend decides when manual notes and manual controller events happen.
- Csound decides how active notes evolve sample by sample.
- Local mode ends at the host sound card.
- Browser_clock mode ends at the browser audio output.

## 12. One Current Implementation Detail

The sequencer config includes `gate_ratio`, but the current backend sequencer runtime does not schedule a separate intra-step note-off based on that value.

In practice, notes are released when one of these happens:

- a new note replaces them
- a non-hold rest occurs
- a boundary action releases them
- transport stops

So the present runtime is more "step/boundary release driven" than "gate-time release driven."
