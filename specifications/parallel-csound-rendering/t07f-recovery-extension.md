# T07f recovery measurement extension

Frozen before additional probes. The original two-branch T07f comparison has fewer parallel
losses (831 versus 953), but its worst recovery bounds overlap: parallel 284.54–337.27 ms,
single 317.35–369.79 ms. It is **inconclusive**, not passed. Roughly 52 ms of command-bound
uncertainty obscures the comparison. The candidate image, native results and successful
600-second soaks remain unchanged.

For a workload whose original three-pulse comparison is complete and inconclusive solely
because of overlapping bounds, collect exactly **six additional pulses per renderer** in
fresh matched sessions. Use a persistent HTTP connection to the local Docker Engine Unix
socket for pause/unpause, removing command-process startup from the measured bounds. Record
host-clock send/completion bounds; do not substitute Docker/VM event clocks or point estimates.
The acknowledged minimum hold remains 1.2 seconds, observation remains 60 seconds and
stability remains ten seconds. Record actual hold bounds too: the original CLI method has
broader hold uncertainty from command overhead; both arms in each matched batch use the
same control method. Reject an actual acknowledged hold shorter than the nominal duration. Six probes take about seven minutes per arm. Audio settings, workload, image,
CPU/memory limits and buffers must match the corresponding ten-minute soaks.

Two-branch extension order is single then parallel, reversing the original pair. If the
pending four-branch comparison is also inconclusive solely from overlapping bounds, apply
the same fixed extension in parallel-then-single order. A real regression, missing/censored
observation, error or playback failure is not eligible for this extension.

Retain all original and added trials. Compare total losses and worst recovery bounds over
**all nine** valid observations per arm using the original no-regression/uncertainty rule.
Do not omit a slower trial, replace the original result, stop early after a favorable trial,
or retry a fixed extension just to obtain a pass. Incomplete added evidence remains
inconclusive. If nine trials still cannot establish the gate, report that limit.

This is measurement refinement, not a relaxed threshold or new renderer candidate. The
original result remains separately visible. Successful existing soaks are not shortened or
relabelled as recovery-only observations. No runtime changes or eligibility registrations
are made by this protocol. Live-input latency remains non-blocking.
