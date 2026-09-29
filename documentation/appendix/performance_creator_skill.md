# Orchestron Performance Creator Skill

Use [Orchestron Performance Creator](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-performance-creator/SKILL.md) to compose, edit, import, validate and save performances using instruments in the library. It guides an agent through the `orchestron_cli` utility, with references for musical form, harmony, rhythm, routing and mixing.

## What It Does

The agent discovers available patches, starts a staged edit, assigns rack instruments, connects their audio paths and adds melodic, drummer, controller or arpeggiator material. It can write a YAML/JSON score for longer arrangements, adjust per-instance sound settings, program note timing and drum rolls, and configure mixer levels and sends. The built-in Master needs no extra speaker instrument.

Before saving, the agent validates the staged performance against the backend. Commit saves the result; creating or updating a live session is a separate, optional step. Existing insert chains are retained, while insert creation and reordering use the app.

## Example Agent Prompt

> Read `integrations/skills/orchestron-performance-creator/SKILL.md` and follow its references. Use the backend at `http://localhost:8000/api`. First list available instruments and choose a drum kit, bass and pad from the library. Create a new 32-bar performance named “Night Drive” at 120 BPM in 4/4 and C minor: four bars of drums, an evolving bass section, a pad-led middle, and a short ending. Keep the bass and pad harmonically compatible, route the instruments to Master, and set balanced levels. Validate and save it without changing existing performances or starting playback. Report the instrument choices and arrangement.

If suitable instruments are missing, the agent should report that and use the Patch Creator skill when creating the missing sounds is part of the request. Avoid assuming that example patch names exist in every library.

## Stage and Save

From the repository root, the agent starts a new edit with:

```bash
uv run --project integrations/skills/orchestron-performance-creator \
  orchestron_cli --json edit begin --new --name "Night Drive"
```

After populating the staged rack, routes and music, validate and save:

```bash
uv run --project integrations/skills/orchestron-performance-creator \
  orchestron_cli --json edit validate
uv run --project integrations/skills/orchestron-performance-creator \
  orchestron_cli --json edit commit
```

See [composition workflow](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-performance-creator/references/composition_workflow.md) and [score specs](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-performance-creator/references/score_spec.md) for detailed authoring instructions.

## Combine Both Skills

Ask the agent to create and validate a new sound with Patch Creator, then read Performance Creator and discover the saved patch in the backend library. It can add that patch to a new performance, connect its Stereo Output to Master, write complementary parts, validate and save. Include the desired names, musical constraints and playback preference in the same request. Creating the patch, saving the performance and starting playback are separate operations.
