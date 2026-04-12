# Clock Owners In Orchestron

This document describes which component owns time in the current implementation.

The old split between `local` and `browser_clock` no longer applies at runtime. All supported platforms now run through the browser-clock path, with `local` accepted only as a compatibility alias that normalizes to `browser_clock`.

## Short Version

There is still no single global clock, but there is one decisive rule:

- the render path that calls `performKsmps()` is the only authority for when MIDI enters Csound

Everything else either:

- timestamps intent
- maps one clock domain into another
- or consumes already-rendered PCM

## The Clock Domains

### 1. Browser playback clock

Owner:

- browser `AudioContext` / `AudioWorklet`

Responsibility:

- final audible playback timing
- browser PCM queue depth
- render refill pressure

This is the clock the listener actually hears.

### 2. Browser event timestamp clock

Owner:

- browser `performance.now()`

Responsibility:

- timestamping manual note and controller events generated in the browser
- timestamping periodic timing reports sent to the backend

The browser does not inject those events into Csound directly. It only timestamps them.

### 3. Host helper timestamp clock

Owner:

- `host-midi-helper` monotonic clock

Responsibility:

- timestamping external hardware or DAW MIDI captured on the host OS

This clock exists only when the optional Rust helper is running.

### 4. Backend monotonic clock

Owner:

- backend `time.perf_counter_ns()`

Responsibility:

- reference clock used by `ClockDomainMapping`
- mapping browser/helper timestamps into server time

### 5. Engine sample clock

Owner:

- `CsoundWorker` render cursor

Responsibility:

- target sample positions for queued MIDI
- block boundaries for `performKsmps()`

This is the most important backend timing domain.

### 6. Csound DSP clock

Owner:

- Csound itself

Responsibility:

- DSP progression within each rendered block
- note evolution after events have entered the engine

## What Owns Sequencer Time

### Sequencer transport: backend render path

The session sequencer is now render-driven for sessions.

That means:

- sequencer advancement happens in `advance_render_block(...)`
- it is called from the browser-clock render path before each backend block render
- there is no session wall-clock transport thread driving note timing

So the backend sequencer runtime owns transport state, but it advances only when audio rendering advances.

## What Owns MIDI Event Timing

### Internal sequencer events

Owner chain:

- backend sequencer runtime decides which events are due
- events are queued into `EngineMidiScheduler`
- render path drains them before the relevant `performKsmps()` block

The final injection time is therefore owned by the render path, not by a sleep-based sequencer thread.

### Browser manual MIDI

Owner chain:

- browser timestamps the event with `performance.now()`
- backend maps that timestamp into backend monotonic time
- backend converts that to a target engine sample
- render path performs final injection

So the browser owns the event timestamp, but the render path owns final execution.

### External host MIDI

Owner chain:

- helper timestamps inbound MIDI on the host
- backend maps helper time into backend monotonic time
- backend converts that to a target engine sample
- render path performs final injection

So the helper owns the capture timestamp, but the render path owns final execution.

### Direct API MIDI

Owner chain:

- backend receives the event
- backend queues it into the engine scheduler
- render path injects it on the next appropriate block

## What Owns Audible Audio Timing

Final audible pacing is owned by:

- the browser audio subsystem

The backend produces PCM on demand, but the browser decides when queued PCM is heard.

## Current Practical Model

If you need the shortest correct mental model, use this:

- the browser owns playback
- the backend render cursor owns engine time
- the render thread owns final MIDI injection into Csound
- Csound owns DSP between injected events

## Important Consequences

### `midi_input` is not the internal performance bus

The session `midi_input` binding only selects an external MIDI source for the session.

It does not control:

- sequencer output
- piano roll output
- manual controller lanes
- other internal app-generated MIDI

Those always use the engine-local path.

### `internal:loopback` is a logical endpoint

`internal:loopback` exists so the UI and API always have a stable input ref, even when there are no OS MIDI devices.

It is not a requirement for internal playback to function.

### Browser timing reports matter

The backend uses browser timing reports to estimate how far rendered audio is ahead of audible time.

That estimate lets manual browser-generated MIDI map more accurately into the engine timeline.

### `ksmps` still matters

Timestamped ingress improves capture and scheduling jitter, but Csound MIDI execution is still effectively quantized by the current k-period.

That is why the runtime warns when `ksmps > 32` on a live session.

## Per-Component Summary

### Frontend

- owns UI interaction timing
- owns manual browser event timestamps
- owns final playback timing

### Host helper

- owns external MIDI capture timestamps

### Session service

- owns controller leases
- owns clock-domain mapping
- routes timestamped events into the engine scheduler

### Engine MIDI scheduler

- owns event ordering by target engine sample

### Csound worker render path

- owns final event injection timing
- owns engine sample cursor progression

### Csound

- owns DSP time after event injection

## Final Answer

When someone asks "who owns the clock?" in the current runtime, the precise answer is:

- the browser owns audible playback
- the backend render path owns engine timing
- the render path is the only authority for when MIDI reaches Csound
