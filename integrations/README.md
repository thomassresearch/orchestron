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
5. Add melodic, drum, controller, or arpeggiator tracks with CLI flags or a YAML/JSON score spec.
6. Validate the staged edit.
7. Commit only after validation succeeds.
8. Optionally push the staged config to a live runtime session for testing.

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
