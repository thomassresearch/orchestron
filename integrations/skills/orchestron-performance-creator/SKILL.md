---
name: orchestron-performance-creator
description: Use when creating, editing, importing, validating, committing, or live-testing Orchestron performances through the skill-local orchestron_cli backend-only command-line utility, including multitrack score specs, melodic chord patterns, General MIDI drum grooves, controller sequencers, manual MIDI controllers, arpeggiators, and patch/performance bundle imports.
---

# Orchestron Performance Creator

Use this skill to create or edit Orchestron performances through the skill-local `orchestron_cli` command. The CLI talks only to the running FastAPI backend; never edit SQLite directly.

## CLI Entry Point

From `integrations/skills/orchestron-performance-creator/`:

```bash
uv run orchestron_cli --api-url http://localhost:8000/api -h
```

From the repository root, either use the skill project explicitly:

```bash
uv run --project integrations/skills/orchestron-performance-creator orchestron_cli --json health
```

or use the thin wrapper:

```bash
uv run python integrations/skills/orchestron-performance-creator/scripts/orchestron_cli.py --json health
```

Use `--json` for agent-readable output and retry hints:

```bash
uv run orchestron_cli --json health
```

If the backend is not running, ask the user whether to start it with `make run` or use the correct `--api-url`.

## Workflow

1. Check backend health.
2. List/import patches as needed.
3. Start an edit session from an existing performance or a new draft.
4. Add instruments first, then sequencers/controllers/arpeggiators.
5. Use explicit CLI flags for small edits.
6. Use a YAML/JSON score spec for multitrack or harmonic generation.
7. Run `edit validate`.
8. Commit only after validation succeeds.
9. For live testing, attach or pass a runtime session ID and run `edit push-runtime`.

## Core Commands

```bash
uv run orchestron_cli --json patches list
uv run orchestron_cli --json performances list
uv run orchestron_cli --json edit begin --new --name "Agent Sketch"
uv run orchestron_cli --json edit add-instrument --patch "TB303" --channel 2
uv run orchestron_cli --json edit add-melodic --channel 2 --steps "s0=C3:min7/4s s4=F3:dom7/4s"
uv run orchestron_cli --json edit add-drummer --channel 10 --groove backbeat
uv run orchestron_cli --json edit validate
uv run orchestron_cli --json edit commit
```

## References

- For melodic step/chord syntax, read `references/chord_syntax.md`.
- For YAML/JSON score specs, read `references/score_spec.md`.

## Error Handling

When a command fails, read the structured `error.retry` field and adjust the next command. Do not commit after a failed validation. Use `--debug` only when backend response details are needed.
