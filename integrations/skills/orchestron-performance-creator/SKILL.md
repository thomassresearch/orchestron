---
name: orchestron-performance-creator
description: Use when creating, editing, importing, validating, committing, or live-testing Orchestron performances through the integrations/cli backend-only command-line utility, including multitrack score specs, melodic chord patterns, General MIDI drum grooves, controller sequencers, manual MIDI controllers, arpeggiators, and patch/performance bundle imports.
---

# Orchestron Performance Creator

Use this skill to create or edit Orchestron performances through the repository CLI in `integrations/cli/`. The CLI talks only to the running FastAPI backend; never edit SQLite directly.

## CLI Entry Point

From the repository root:

```bash
uv run python -m integrations.cli --api-url http://localhost:8000/api -h
```

Use `--json` for agent-readable output and retry hints:

```bash
uv run python -m integrations.cli --json health
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
uv run python -m integrations.cli --json patches list
uv run python -m integrations.cli --json performances list
uv run python -m integrations.cli --json edit begin --new --name "Agent Sketch"
uv run python -m integrations.cli --json edit add-instrument --patch "TB303" --channel 2
uv run python -m integrations.cli --json edit add-melodic --channel 2 --steps "s0=C3:min7/4s s4=F3:dom7/4s"
uv run python -m integrations.cli --json edit add-drummer --channel 10 --groove backbeat
uv run python -m integrations.cli --json edit validate
uv run python -m integrations.cli --json edit commit
```

## References

- For melodic step/chord syntax, read `references/chord_syntax.md`.
- For YAML/JSON score specs, read `references/score_spec.md`.

## Error Handling

When a command fails, read the structured `error.retry` field and adjust the next command. Do not commit after a failed validation. Use `--debug` only when backend response details are needed.

