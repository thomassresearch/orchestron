# Orchestron Patch Creator Skill

Use [Orchestron Patch Creator](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-patch-creator/SKILL.md) to turn a sound description into an Instrument Design patch, or to revise an existing instrument or effect. The skill combines synthesis guidance with the `orchestron_patch_cli` utility.

## What It Does

The agent chooses a suitable template family, writes a structured patch spec, validates it, and creates or updates the graph through the backend. Specs describe sources, envelopes, processing, output, input formulas and optional `perf_controller` settings for later adjustment in the rack. Generated instruments expose a named Stereo Output; route it through the performance mixer to Master when using the instrument in a performance.

For an existing graph, preserve stable node IDs and its control-flow structure. The high-level layer syntax does not create If/Switch branches automatically. See [patch specs and graph compatibility](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-patch-creator/references/patch_spec.md) for these details.

## Example Agent Prompt

> Read `integrations/skills/orchestron-patch-creator/SKILL.md` and follow its references. Use the backend at `http://localhost:8000/api`. Create a new MIDI instrument named “Glass Pad” with a soft attack, a clear bell-like tone, gentle stereo movement and a long release. Expose attack and release as rack controls. Preserve existing instruments. Validate and compile the patch, render representative notes and release tails, and inspect both Mel and log-frequency STFT spectrograms. Report the saved name and which audio checks you performed. Do not start live playback.

The agent should check finite samples, clipping, both channels, velocity response and relevant controller settings. Spectrogram inspection supports verification; it does not replace listening or justify claiming that listening occurred.

## Local Validation and Library Creation

After the agent has written `patch.yaml`, these commands illustrate the boundary between local validation and a backend write. Run them from the repository root:

```bash
uv run --project integrations/skills/orchestron-patch-creator \
  orchestron_patch_cli --json spec validate patch.yaml
uv run --project integrations/skills/orchestron-patch-creator \
  orchestron_patch_cli --json patch create patch.yaml --compile
```

Use `patch update PATCH_ID patch.yaml --compile` for an explicitly selected existing patch. A failed validation or compile preflight must be corrected before updating it. See the [authoring workflow](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-patch-creator/references/workflow.md) and [audio validation procedure](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-patch-creator/references/audio_validation.md) for the full process.
