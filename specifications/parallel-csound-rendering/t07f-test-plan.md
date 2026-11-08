# T07f qualification after Linux worker placement

T07e failed its two-branch parallel playback gate before any intervention: warmup and
subsequent playback had underruns. Read-only scheduling samples showed the independent
workers repeatedly sharing virtual CPU 0 despite a 0–11 affinity mask and four-CPU quota.
The already-failed arm then received an explicitly recorded diagnostic intervention placing
its three workers on CPUs 0, 1 and 2. Rendering accelerated and underruns stopped increasing.
That arm is permanently ineligible; its later intervals/recovery are diagnostic only. The
remaining planned T07e single-two arm is cancelled because a new candidate is required.
Retain all T07e observations and the intervention timestamp; do not select its successful
intervals or reuse its successful four-branch pair to qualify the new image.

T07f retains all [T07e acceptance criteria](t07e-test-plan.md): 600-second paired soaks,
zero parallel warmup/playback underruns, >=20% native p95 reduction on two heavy workloads,
no native p99 regression, exact correctness, identical buffers/timing, three matched
1.2-second recovery pauses, and non-blocking historical live-input latency. No threshold
is relaxed after the failure. Single stays default/fallback and exports remain canonical.

The new candidate changes only Linux native-owner startup placement. Within this API
process, coordinators reserve distinct logical CPUs from their current allowed affinity.
Reservations survive failed cleanup and release only after reaping. The child verifies its
own placement before native compilation/Ready. Parent/compiler/single renderer remain
unpinned; quota, cpuset, memory and preparation headroom admission still apply. Unsupported
platforms retain their scheduler behavior. Placement failure follows the existing startup
error/auto-single fallback. This does not reserve CPUs against other applications or map
virtual CPUs to exclusive physical cores.

Before timing, run CPU-placement ownership/failure/fallback and existing renderer/session
regressions, then final-image native parity, tiny-sample checks, controller fan-out and
paired three-round native benchmarks (98,304 frames, 512-frame requests). Verify actual
child CPU affinity and unchanged parent affinity on Linux. Freeze a new image before the
browser runs. Use the same Linux ARM64/float64/Cython environment, four CPUs, 2 GiB RAM,
64 MiB shared memory, 48 kHz/K=32 and unchanged browser settings/ring.

Fresh arm order: **parallel two, single two, single four, parallel four**. Each gets retained
ten-second warmup, >=600-second playback and the unchanged recovery probes. No builds,
tests or other benchmarks overlap timed observations. Resource snapshots also record
actual allowed CPU masks; the three render workers must have distinct singleton masks.
No intervention is permitted in these qualification arms. Any new playback failure blocks
G7 and remains visible. Reports never register eligibility or enable T08 rollout.
