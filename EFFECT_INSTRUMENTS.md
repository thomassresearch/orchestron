# Always-On Effect Instruments

This document captures the implemented design for always-on instruments used as audio effects in performances.

## User Model

- A patch can be marked `Always On?` in Instrument Design.
- Always-on patches are not started by MIDI note events.
- Always-on patches only participate in a performance when the user explicitly adds them to the Perform rack.
- Normal patches keep their existing behavior and MIDI channel assignment.
- The user is responsible for adding `outleta` nodes to source instruments and matching `inleta` nodes to effect instruments.

## Audio Routing

Effect routing is defined in the Perform rack.

When an always-on patch is selected in a rack slot, the rack shows an audio source matrix instead of a MIDI channel field. The matrix lists normal rack instruments that expose audio with `outleta`. For each matching `outleta` channel label, it shows a checkbox.

A checkbox is available only when:

- the source rack slot is a normal instrument,
- the source patch contains an `outleta` whose `sname` is either a literal value or a direct `const_s.sout` connection,
- the always-on patch contains an `inleta` with the same resolved `sname`.

Checking a row stores an explicit route:

```json
{ "sourceId": "src-rack-slot-id", "channel": "left" }
```

The compiler emits the matching Csound route:

```csound
connect "vcs_instr_1", "left", "vcs_instr_2", "left"
```

If a rack instrument is added, removed, or changed, the route list is normalized against the current rack and patch port labels. Routes whose source slot or channel label no longer exists are removed.

## Runtime Compilation

Perform sessions normalize assignments before Csound compilation:

- normal instruments require unique MIDI channels `1..16`;
- always-on instruments use MIDI channel `0`;
- always-on instruments keep their selected effect route cells;
- normal instruments discard effect route fields.

When any always-on instrument or route is present, the compiler emits named Csound instruments (`vcs_instr_1`, `vcs_instr_2`, ...). Normal instruments are mapped with named `massign` statements, while always-on instruments are skipped by `massign` and started with `alwayson`.

Example:

```csound
massign 0, 0
massign 1, "vcs_instr_1"

connect "vcs_instr_1", "left", "vcs_instr_2", "left"

alwayson "vcs_instr_2"

instr vcs_instr_1
  ; normal source instrument
endin

instr vcs_instr_2
  ; always-on effect instrument
endin
```

The previous numeric instrument output is preserved when no always-on/routing feature is used.

## Export Behavior

Performance bundle snapshots persist:

- `alwaysOn` on patch definitions;
- stable rack assignment `id` values;
- `effectRoutes` on always-on rack assignments.

Offline performance CSD export uses the same compiler path as live sessions. Always-on instruments are started with `alwayson`; no score `i` event is emitted for them.

The exported CSD score still contains a finite `f 0 <duration>` line. The duration is the MIDI playback range plus the existing release tail buffer, so routed effects such as reverbs and flangers can decay after the last MIDI event.
