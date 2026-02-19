# Tools

Native macOS MIDI diagnostics used to isolate timing behavior outside the main app runtime.

## Contents

- `midi_pulse.c`: MIDI note pulse sender (CoreMIDI output)
- `midi_stats.c`: MIDI note-on receiver statistics probe (CoreMIDI input)

## Build

From project root:

```bash
make midi-pulse-build
make midi-stats-build
```

Binaries:

- `./tools/midi_pulse`
- `./tools/midi_stats`

## `midi_pulse` (sender)

List destinations:

```bash
./tools/midi_pulse --list
```

Example:

```bash
./tools/midi_pulse --dest 0 --channel 1 --note 60 --interval-ms 5 --gate 0.2 --count 5000 --report-every 250
```

Useful options:

- `--dest <name|index>`
- `--channel <1-16>`
- `--interval-ms <ms>`
- `--gate <0.0-1.0>`
- `--count <N>`
- `--report-every <N>`
- `--verbose`

## `midi_stats` (receiver)

List sources:

```bash
./tools/midi_stats --list
```

Example:

```bash
./tools/midi_stats --dest 0 --channel 1 --report-every 250
```

Useful options:

- `--dest <name|index>`
- `--channel <1-16>`
- `--report-every <N>`
- `--count <N>`

What it reports:

- Event interval statistics: mean/std/min/max (ms)
- Jitter statistics vs first observed interval: ref/mean/abs_mean/std/min/max (ms)
- Timestamp coverage: how many events have non-zero CoreMIDI timestamps (`ts_ratio`)
- `timestamp_only` stats: interval/jitter computed only from event timestamps
- `arrival_vs_timestamp` stats: callback arrival time minus event timestamp

## Typical workflow

Terminal 1 (receiver):

```bash
./tools/midi_stats --dest 0 --channel 1 --report-every 250
```

Terminal 2 (sender):

```bash
./tools/midi_pulse --dest 0 --channel 1 --interval-ms 5 --gate 0.2 --count 5000 --report-every 250
```

Use the same MIDI bus/device and channel on both commands.
