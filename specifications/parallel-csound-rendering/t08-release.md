# T08 opt-in playback and observation

The public session request defaults to `renderer_mode="single"`. It constructs the original
`CsoundWorker` directly. `renderer_mode="auto"` requests graph-based parallel playback with
single fallback; forcing unqualified/strict-parallel execution is not a public API option.
The Perform checkbox supplies the current browser settings and applies only while stopped.
The preference is browser-session state, excluded from autosave, performances and exports.
A changed preference invalidates a stopped session before the next Start; in-flight creation
with stale settings is discarded. It cannot replace an active renderer.

## Graph selection and rollback

The [whole-instrument contract](whole-instrument-partitioning.md) supersedes the original
per-song release catalog. Public opt-in analyses the current graph; neither installed evidence
nor exact browser settings are required. `VISUALCSOUND_PARALLEL_QUALIFICATION_FILE` is deprecated
and ignored by playback. Historical catalogs and their offline validator remain benchmark
artifacts; they do not approve or reject songs. The `qualified` diagnostic continues to mean
matched benchmark evidence, so graph-selected playback reports `false` without such evidence.

`VISUALCSOUND_PARALLEL_PLAYBACK_ENABLED=true` permits an explicit request; sessions still default
to single. Set it to `false` for rollback. Configuration changes apply at startup, preparation
and Start, never by replacing an active renderer. The public API cannot force strict parallel
execution, inject costs/evidence or bypass resource and capacity admission.

Cgroup CPU/memory/shared-memory admission, startup CPU placement, worker-failure quarantine,
ordered event delivery and cleanup contracts remain in force. The checkbox remains stopped-only;
changing browser settings preserves the existing session recreation behavior and buffer values.

## CPU observation

`GET /api/sessions/{id}/engine-stats` returns session state, optional existing renderer
diagnostics, availability/scope and CPU values. The service runs procfs reads in a worker
thread, outside lifecycle/render locks. A locked per-session cache bounds counter reads to
at most once per second per unchanged owner set. Observation never calls render, advances
transport, writes control channels or refreshes idle-session activity. Deleted sessions return
404. Stop/restart or owner changes reset baselines; missing counters/unsupported platforms
produce unavailable/null, never invented zero load.

Parallel reports Linux `/proc/stat` utilization on verified singleton CPU assignments. Idle
and iowait are excluded from busy time; guest counters are not counted twice. These are total
logical-CPU readings and can include unrelated work. Single rendering remains unpinned and
reports server-process CPU usage (`/proc/self/stat`, 100% = one CPU), including non-audio API
work. Neither scope is a per-instrument DSP meter or a cgroup quota percentage.

The fixed 28-pixel Perform footer owns its React state, with sequential approximately-one-second
requests. It cancels observation on unmount, suspends hidden-tab polling, and ignores stale
session responses. It reserves page space, scrolls horizontally on narrow screens and does
not interrupt the browser audio worker. Values use green <=50%, orange >50..85%, red >85%;
this fills the user's unspecified 50–60% interval. Labels/help are localized EN/DE/FR/ES.

## Verification

See the prospective [T08 test protocol](t08-test-plan.md) and implementation record for actual
results and image scope. Historical fabricated records exercise offline report validation only. Current API tests prove
graph selection without installed profiles, default single playback and rollback.
