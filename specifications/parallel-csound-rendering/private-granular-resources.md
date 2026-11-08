# Private granular resources (2026-11-08)

Resource capability v3 adds standalone `ftgenonce` ownership and explicitly seeded
`grain3` voice state. No song registration, public compiler/export change, synthesis
block change, buffering change or renderer-default change is involved.

## Proof and fallback rules

- Audit the shipped opcode definition before accepting a private table producer or reader.
- Accept auto-numbered `ftgenonce` with a fixed, positive, bounded table size and numeric
  GEN10/20 (including negative, unnormalized variants). Other generators, numbered writes,
  unknown sizes, arithmetic/escaping handles and unaudited consumers retain single fallback.
- Follow each `ift` output directly to supported read-only table inputs, including a validated
  identity formula. Such handles are local to their owning instrument and may differ between
  native processes without changing samples. Csound can share identical cache entries inside
  a process; read-only duplication across processes is equivalent.
- Unresolved numeric/dynamic references or mutable tables alongside private automatic tables
  force fallback: they could observe or overwrite the native automatic IDs. Existing shared
  numbered GEN table ownership rules remain unchanged.
- `grain3` maintains its own RNG state for a positive explicit seed. Prove a finite seed range
  1–2147483646 from constants or controller ranges and supported pure interval arithmetic.
  Zero/time-derived or unprovable seeds retain fallback. Genuine engine-global random users
  (including the drumkit's noise) remain colocated. No seed values or note order are rewritten.

## Cache capacity

Unlike a temporary table, `ftgenonce` retains each unique argument tuple until engine cleanup.
Pitch-dependent formulas and live controller edits can create further entries. Reserve 512
entries per producer, pooled within its worker, charging the largest private table size in the
whole plan plus 4 KiB metadata per entry and one spare per producer. This intentionally
conservative estimate is included in normal cgroup admission.

Only internal partition lowering appends an init-time automatic-table-ID limit after each
`ftgenonce`. Csound 6 allocates automatic IDs from 101; with no other unproven table domain,
`100 + producers_in_worker * 512` bounds the cache. `exitnow 1` on exhaustion returns failure
to the native owner. The existing coordinator withholds the failing request, reaps workers,
and retains next-start single fallback. Tables are never evicted or overwritten under active
voices. Canonical single/LIVE/OFFLINE CSDs contain no new guard.

Source audit: [ftgenonce manual](https://csound.com/docs/manual/ftgenonce.html),
[grain3 manual](https://csound.com/docs/manual/grain3.html), Csound 6.18
[grain3set/oscbnk_seedrand](https://github.com/csound/csound/blob/6.18.0/Opcodes/oscbnk.c),
[FTAlloc](https://github.com/csound/csound/blob/6.18.0/Engine/fgens.c),
[ftgenonce cache](https://github.com/csound/csound/blob/6.18.0/Opcodes/signalflowgraph.cpp).

## Initial Grain of Salt result (v3)

The results below record the initial resource fix. Capability v4 subsequently changes
the default split to six workers using [conditional DSP estimates](conditional-work-estimates.md);
the ownership and cache rules above remain unchanged.

The frozen live rack contains seven Granular Synthesis instances, Analog Drumkit,
Stereo Delay, Reverb Effect and the bass Tube Overdrive insert. At unchanged 48 kHz,
ksmps=16 and 128/512 Csound buffers, the current structural balancing heuristic chooses:

1. Drums.
2. Seven granular instances and the private bass insert.
3. Delay, reverb and Master/output.

This three-worker choice is a balancing heuristic, not a remaining shared-table/RNG
constraint. A separate test cost profile places the granular instruments across at least
six owners and verifies exact samples and meters. Production still uses ordinary graph
selection, with no benchmark profile or catalog injected.

Native tests cover sequential exact samples/meters, persistent byte-identical float32 PCM
at batch sizes 32/256/1024, timestamped overlapping notes/CC, live harmonic/seed controls,
unsafe graph fallback and forced cache exhaustion without partial publication. An isolated
Linux Docker run with 12 CPUs and 2 GiB memory admits the default three-worker plan and
matches single PCM exactly. The plan reserves 500,154,480 bytes for private cache capacity.
These are correctness/admission tests, not a realtime performance qualification or a claim
of speedup. Planner snapshots only change capability/input/plan identities; existing ownership,
buses and costs remain identical. Frozen canonical CSD hashes are not regenerated.

Verification covered 1,311 backend cases across the broad run and corrected targeted reruns,
including all compiler/opcode/API tests and partition snapshots. The snapshot updates were
checked to contain only new digests; the existing failure-recovery assertion now reflects
atomic coordination batches (zero committed samples when their second step fails). The new
API test uses the fixture's actual ksmps=16. Final targeted planner/controller checks: 111
passed; API follow-up: nine passed plus the corrected Grain API case passed. Backend lint
and diff checks passed. Logs are under `output/grain-partitioning/` (local artifacts).
