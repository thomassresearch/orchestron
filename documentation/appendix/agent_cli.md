# Agent CLI

Two utilities under `integrations/skills/` support repeatable authoring from YAML/JSON specs.

| Utility | Purpose |
| --- | --- |
| `orchestron_patch_cli` | Generate instrument graphs, validate patch specs, and create, update or compile library patches. |
| `orchestron_cli` | Discover instruments, stage and save performances, configure routing and mixers, import/export, and manage optional live sessions. |

## Connect and Discover

Run these read-only checks from the repository root:

```bash
uv run --project integrations/skills/orchestron-patch-creator \
  orchestron_patch_cli --json health
uv run --project integrations/skills/orchestron-performance-creator \
  orchestron_cli --json patches list
```

Both default to `http://localhost:8000/api`; use `--api-url http://HOST:PORT/api` for another backend. `--json` returns structured results and retry hints; `--help` lists commands. Use `performances list` to discover saved performances, and inspect actual names, IDs and ports before editing.

## Validate, Save and Optionally Play

For patches, `spec validate` checks a spec locally; `graph render` produces inspectable JSON. `patch create` and `patch update` write through the backend. Add `--compile` for compile preflight before the final write, then follow the patch skill’s audio checks.

For performances, begin a staged edit, add instruments, routes and music, then run `edit validate` before `edit commit`. Validation checks references and routes with the backend; commit saves without starting playback.

For live testing, `edit create-runtime --start` creates and starts a CLI-owned session. `edit push-runtime` updates sequencer, arpeggiator, mixer and controller values with a matching compiled rack; `edit rebuild-runtime` handles instrument, patch or route changes. Continuous instruments need a restart for I-rate controller changes. Audible browser-clock playback requires a connected browser audio client.

## Capabilities and Detailed References

The performance utility writes configuration version 18 and accepts versions 1–18. It preserves routing, mixer state, instance overrides, arrangement metadata and existing insert chains. Use the app to create or reorder inserts.

- **Sound settings:** discover and set per-instance values with `edit performance-controllers list/set/reset`. Patch specs define the controls; performance edits set their overrides. See [controller authoring](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-patch-creator/references/performance_controllers.md) and [instance settings](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-performance-creator/references/performance_controllers.md).
- **Routing and mixing:** `edit instruments list`, `edit routes` and `edit mixer` expose ports, main/send paths and strip controls. Quote shell identifiers such as `'$master'`. The optional standard-effects preset requires suitable effect patches. See [routing](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-performance-creator/references/effect_routing.md), [mixer controls](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-performance-creator/references/mixer.md) and [the preset](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-performance-creator/references/standard_effect_patching.md).
- **Patterns and expression:** discover tracks with `edit sequencers list`; use `edit step-timing` for early/late notes and `edit ratchets` for drum rolls and velocity ramps. Pads are numbered 1–8; steps start at 0. See [timing](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-performance-creator/references/step_timing.md), [ratchets](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-performance-creator/references/step_ratchets.md) and [score specs](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-performance-creator/references/score_spec.md).

The backend launch option `--audio-output-mode browser_clock` belongs to the application server, not to either authoring utility. Browser-clock mode is the normal audio path.
