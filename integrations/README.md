# Integrations

This directory contains integration tooling and examples for driving VisualCSound from outside the main UI. The current primary integration is the Orchestron performance creator skill, which lets an agent create, edit, validate, import, export, and live-test performances through the running backend API.

## Orchestron Performance Creator Skill

The skill lives in [`skills/orchestron-performance-creator`](skills/orchestron-performance-creator). It exposes a backend-only CLI named `orchestron_cli`; the CLI talks to the FastAPI app and does not edit SQLite directly.

Run commands from the repository root with the skill project selected:

```bash
uv run --project integrations/skills/orchestron-performance-creator orchestron_cli --json health
```

The backend must be running and reachable at the default API URL, `http://localhost:8000/api`, unless `--api-url` is supplied.

Typical agent workflow:

1. Check backend health.
2. List available patches and existing performances.
3. Start an edit session for a new or existing performance.
4. Add instrument assignments before sequencers.
5. Connect exact main/send routes to effects and the built-in Master, and stage mixer levels. Add melodic, drum, controller, or arpeggiator tracks with CLI flags or a YAML/JSON score spec.
6. Validate the staged edit.
7. Commit only after validation succeeds.
8. Optionally push mixer/controller/sequencer values to a matching live runtime, or rebuild it after rack or route changes.

Common commands:

```bash
uv run --project integrations/skills/orchestron-performance-creator orchestron_cli --json patches list
uv run --project integrations/skills/orchestron-performance-creator orchestron_cli --json performances list
uv run --project integrations/skills/orchestron-performance-creator orchestron_cli --json edit begin --new --name "Agent Sketch"
uv run --project integrations/skills/orchestron-performance-creator orchestron_cli --json edit add-instrument --patch "TB303 using VCO" --channel 2
uv run --project integrations/skills/orchestron-performance-creator orchestron_cli --json edit add-drummer --channel 10 --groove four_on_floor
uv run --project integrations/skills/orchestron-performance-creator orchestron_cli --json edit validate
uv run --project integrations/skills/orchestron-performance-creator orchestron_cli --json edit commit
```

For larger arrangements, use a score spec and apply it to an active edit session:

```bash
uv run --project integrations/skills/orchestron-performance-creator orchestron_cli --json edit apply-score path/to/score.yaml
```

See the skill references for supported melodic step/chord syntax and score-spec fields:

- [`skills/orchestron-performance-creator/references/chord_syntax.md`](skills/orchestron-performance-creator/references/chord_syntax.md)
- [`skills/orchestron-performance-creator/references/score_spec.md`](skills/orchestron-performance-creator/references/score_spec.md)

### Mixer and Master routing

Every performance has the built-in `$master` endpoint with exact `left/right` inputs; it needs no speaker patch or rack assignment. Use `edit instruments list` to discover instance IDs and routable outputs, including `$direct.left/right` for direct-output patches. Quote dollar-prefixed identifiers in the shell.

From the skill directory, with a staged performance and the required effect patches available:

```bash
uv run orchestron_cli --json edit add-standard-effects --send-gain-db -12
uv run orchestron_cli --json edit routes list
uv run orchestron_cli --json edit mixer list
uv run orchestron_cli --json edit mixer strip set --binding '$master' --gain-db -3
```

This optional preset sends instrument main outputs and a shared reverb return through a compressor into Master. It reuses routable direct outputs without cloning patches. New sends otherwise start silent; `edit mixer send set` accepts repeated `--route` IDs to change a stereo pair atomically. `edit routes add --kind main|send|custom` supports explicit routing, and `edit routes remove --id` removes one exact connection. The obsolete `--speaker-patch` flag reports an error before editing.

See [routing](skills/orchestron-performance-creator/references/effect_routing.md), [mixer controls and TB303 Demo](skills/orchestron-performance-creator/references/mixer.md), and [the optional preset](skills/orchestron-performance-creator/references/standard_effect_patching.md). Existing insert chains are preserved; use the app to create or reorder inserts. Tests use a versioned synthetic mix in the skill's `tests/fixtures/`, independent of developer examples.

## Example: AI Generated Nr1

The first generated example performance is exported as [`examples/AI_generated_Nr1.orch.zip`](examples/AI_generated_Nr1.orch.zip). The prompt transcript is saved as [`examples/AI_generated_Nr1_prompt.txt`](examples/AI_generated_Nr1_prompt.txt).

The session started by checking the configured patches:

```text
/orchestron-performance-creator what instruments (patches) are currently configured?
```

The available patches included:

```text
PAD with VCOs and LFOs
Roland TR808
TB303 using VCO
```

The performance was then generated from this prompt:

```text
Create a new performance, a techno style 4/4 beat (use Roland TR808), with a bassline (use TB303 using VCO) and a synth pad (using PAD with VCOs and LFOs).
The performance should start with an short, drum only intro, then the bassline should evolve, and finally the synth pad harmonies should set in. The performance should end with a part only using the synth pad.
Make sure the harmonies between bassline and synthpad match, make it interesting while still being techno.
Save the performance as "AI generated Nr1".
```

Resulting performance summary:

```text
Name: AI generated Nr1
Tempo: 132 BPM
Form: short drum-only intro, evolving TB303 bassline, matching pad harmonies, pad-only ending
Instruments:
- Channel 10: Roland TR808
- Channel 2: TB303 using VCO
- Channel 3: PAD with VCOs and LFOs
Harmony: C Dorian/minor
```

Use this example as a small reference for agent-driven performance creation: first ask the skill what material is available, then give a concrete musical brief with named patches, arrangement shape, harmonic constraints, and the final performance name.
