# T08 opt-in playback and observation

The public session request defaults to `renderer_mode="single"`. It constructs the original
`CsoundWorker` directly. `renderer_mode="auto"` requests qualified parallel playback with
single fallback; forcing unqualified/strict-parallel execution is not a public API option.
The Perform checkbox supplies the current browser settings and applies only while stopped.
The preference is browser-session state, excluded from autosave, performances and exports.
A changed preference invalidates a stopped session before the next Start; in-flight creation
with stale settings is discarded. It cannot replace an active renderer.

## Operator catalog and rollback

The supplied [catalog](t08-qualified-workloads.json) covers only the two exact fixture graphs
and native build in the [T08 qualification summary](t08-qualification-summary.md). Mount it
read-only in the recorded image, then set `VISUALCSOUND_PARALLEL_QUALIFICATION_FILE` to that
container path. Keep the recorded CPU/memory/shared-memory limits and browser settings.
Validate with `--runtime` inside the deployed image before starting sessions. A graph from
another library with different instance identities requires its own reviewed evidence.
The file is not loaded automatically and no existing deployment is modified by this change.

`VISUALCSOUND_PARALLEL_QUALIFICATION_FILE` names an operator-reviewed JSON catalog outside
`backend/app/`. No catalog means single fallback. The default capability switch
`VISUALCSOUND_PARALLEL_PLAYBACK_ENABLED=true` permits the explicit request; it does not opt
in any session. Set it to `false` for rollback. Configure these on the server and restart it;
drain or explicitly stop active playback first. There is no silent active-engine replacement.
The current settings object is also rechecked at preparation and Start, including a previously
prepared candidate. Rollback retains authored data and canonical export paths.

Validate a catalog before installation:

```sh
.venv/bin/python -m backend.tools.validate_render_release /path/to/catalog.json --runtime
.venv/bin/python -m backend.tools.validate_render_release --schema /tmp/render-release.schema.json
```

The validator checks data and native identity; it does not measure, approve or fabricate
qualification. The catalog must contain at least two distinct passing heavy workloads for
the current build and matching browser settings. Version 1 contains `policy` (mode `auto`)
and `profiles`, each with `input_hash`, `costs` and `evidence`. The schema describes all fields.
Costs retain their exact integer/float representation because they enter the plan digest.
The cost provenance describes planning inputs; only measurements establish useful scaling.

Catalogs are bounded to 1 MiB and 64 profiles, reject unknown fields and nonfinite costs,
and require passing evidence plus full digests. Missing, malformed or oversized catalogs,
stale builds, changed browser settings, unrecognized input graphs and compiled-plan/artifact
mismatches remain single. Records/costs supplied by a browser never authorize execution.
All existing cgroup CPU/memory/shared-memory admission, startup CPU placement, worker-failure
quarantine, ownership and cleanup contracts remain in force. No `allow_unqualified` setting
is exposed by deployment configuration. The old explicit `create_app(renderer_options=...)`
injection remains available for controlled tests and qualification collection only.

A catalog is specific to its measured workload envelope. It is not blanket approval for
new patches, more voices or arbitrary control/event pressure. Changes to application sources,
native Csound/binding/dependencies, compiled modules or hardware invalidate the exact runtime
fingerprint. Changed graph/engine settings, instance identities, policy/costs and initial
compiled artifacts invalidate the corresponding profile. Historical G7 measurements are not
rewritten or copied onto a new build identity.

Browser-policy matching uses the settings supplied when creating the session. Existing live
latency controls retain their behavior and do not replace an active renderer. After Stop,
the next Start creates a fresh session if those settings changed and checks the new policy.
The qualification flag records the evidence used for selection, not a continuous guarantee
for every later event stream or live browser-policy change.

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
results and image scope. Fabricated records in unit/API tests exercise gate behavior only;
they are never installed or reported as performance qualification.
