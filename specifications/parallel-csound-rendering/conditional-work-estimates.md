# Conditional DSP work estimates (2026-11-08)

Graph capability v4 retains all v3 resource rules and adds `RenderStage.estimated_work`,
a positive integer used only when the planner has no explicit cost profile. It estimates
relative work for one voice, not microseconds, live CPU usage or future polyphony.

## Contract

For each patch, count the existing voice-scoped DSP resources by node. Its estimate is:

`1 + common voice work + sum(max(case work) for each If/Switch block)`

A note selects one case in each block. The maximum includes Default and is independent of
current MIDI notes, switch values, branch order or typical playing patterns. A silent case
adds zero synthesis work. Independent root blocks may execute together, so sum their maxima.
Nested blocks are forbidden by the current control-flow model. Multiple overlapping notes
may select different cases; this is a per-voice estimate, not a claim that only one drum can
sound at a time. No active-voice or arrangement analysis is performed.

All resource accesses, allocations, shared random streams, table aliases and safety blockers
still include **every** case. Cost reduction does not discard dormant synthesis or loosen
ownership. Whole instruments remain indivisible. Patches without control flow keep exactly
the prior estimate. Routing/mixer/output stage overhead stays one unit. Explicit cost profiles
take precedence and retain their measured-benefit gate. Unsupported graphs, insufficient
capacity and ordinary single-renderer defaults are unchanged.

The estimate is immutable graph metadata, covered by the plan digest and graph equality
checks. Invalid/non-integer/non-positive estimates are rejected. Capability-v4 snapshot
refreshes changed only graph and plan identities; existing synthetic snapshot ownership,
buses and explicit cost-profile values were checked unchanged. Canonical CSDs and frozen
export hashes are not regenerated.

## Grain of Salt

The fixture's Analog Drumkit has 18 Switch cases. Its per-note estimate falls from 244
summed work units to 30 (common nodes plus its heaviest case). Each granular instance stays
at 18 units. With 12 available CPUs and 2 GiB container memory, ordinary graph selection and
capacity admission now select six workers:

| Worker | Instruments | Relative work including routing |
| --- | --- | ---: |
| upstream-0 | Bass and its Tube Overdrive insert | 39 |
| upstream-1 | Analog Drumkit | 35 |
| upstream-2 | Air, Dust | 46 |
| upstream-3 | Clockwork, Glass | 46 |
| upstream-4 | Clouds, Theme | 46 |
| downstream | Delay, Reverb, Master/output | 26 |

The existing bin-packing rule prefers the fewest workers reaching the best estimated
maximum load. Seven or eight total workers still leave a paired branch at 46 units, so six
wins that tie. This is not a calibrated estimate of grain3 overlap cost or a runtime-adaptive
scheduler. Different polyphony, notes or effects can change the actual balance.

Validation uses the versioned performance fixture, overlapping MIDI notes across six drum
cases (kick/snare/closed and open hi-hat/crash/ride), all seven granular instances, timestamped
CCs and live seed/harmonic changes. Sequential samples/meters and persistent float32 PCM are
compared exactly at coordination sizes 32/256/1024. The separate Linux Docker probe uses real
capacity detection and unchanged 48 kHz, ksmps=16, Csound buffers 128/512, batch size 256.
No live app or saved performance is changed. These checks establish correctness and admission;
they do not constitute a ten-minute browser performance qualification.

Checks: 298 cost/planner/native/compiler regression tests and 10 selected public API
tests passed. Backend lint and diff checks passed. The isolated Docker probe admitted six
workers and produced byte-identical PCM for 49,152 engine samples. Test logs and Docker
evidence are retained locally under `output/branch-costs/`.
