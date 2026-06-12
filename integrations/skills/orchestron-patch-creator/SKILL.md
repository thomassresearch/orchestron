---
name: orchestron-patch-creator
description: Use when creating, editing, validating, compiling, or importing Orchestron Instrument Design patches from natural-language sound descriptions, synth recipes, or structured patch specs through the skill-local orchestron_patch_cli backend utility, including oscillator, subtractive, FM, noise, filter, modulation, effect, velocity, envelope, pan, and output graph generation.
---

# Orchestron Patch Creator

Use this skill to create or update Orchestron Instrument Design patches. Translate the user's sound description into a structured patch spec, then use the skill-local `orchestron_patch_cli` command to generate graph JSON and create/update the patch through the running FastAPI backend. Never edit SQLite directly.

## CLI Entry Point

From `integrations/skills/orchestron-patch-creator/`:

```bash
uv run orchestron_patch_cli --api-url http://localhost:8000/api -h
```

From the repository root:

```bash
uv run --project integrations/skills/orchestron-patch-creator orchestron_patch_cli --json health
```

or use the thin wrapper:

```bash
uv run python integrations/skills/orchestron-patch-creator/scripts/orchestron_patch_cli.py --json health
```

Use `--json` for agent-readable output and retry hints. If the backend is not running, ask the user whether to start it with `make run` or pass the correct `--api-url`.

## Workflow

1. Read `references/workflow.md` for the end-to-end creation process.
2. Read `references/patch_spec.md` before writing a YAML/JSON spec.
3. Read `references/template_families.md` to choose the smallest suitable template family.
4. Read opcode references only as needed:
   - `references/opcodes_core.md` for required MIDI/envelope/gain/pan/output nodes.
   - `references/opcodes_synthesis.md` for source and synthesis opcodes.
   - `references/opcodes_effects.md` for filters, distortion, delay, and reverb.
   - Use the original Csound opcode reference at https://csound.com/docs/manual/PartReference.html for detailed opcode semantics when the local reference is not enough.
5. Write a structured patch spec.
6. Run `spec validate`.
7. Run `graph render` if you need to inspect graph JSON.
8. Run `patch create` or `patch update`; use `--compile` unless the patch is intentionally incomplete and saved as a template.

## Core Commands

```bash
uv run orchestron_patch_cli --json templates list
uv run orchestron_patch_cli --json spec validate patch.yaml
uv run orchestron_patch_cli --json graph render patch.yaml --out patch.graph.json
uv run orchestron_patch_cli --json patch list
uv run orchestron_patch_cli --json patch create patch.yaml --name "Evolving FM Pad" --compile
uv run orchestron_patch_cli --json patch update PATCH_ID patch.yaml --compile
uv run orchestron_patch_cli --json patch compile PATCH_ID
```

## Required Graph Principles

The CLI enforces these defaults in generated graphs:

- Use `cpsmidi` for played MIDI note pitch.
- Use `ampmidi` for played MIDI velocity.
- Connect `ampmidi.iscal` from a `const_i` node with value `1.0`.
- Use `madsr` for the main amplitude envelope.
- Connect `madsr.iatt`, `madsr.idec`, `madsr.islev`, and `madsr.irel` from `const_i` nodes because these are i-rate inputs.
- Use `foscili` only for one carrier plus one modulator. It derives carrier and modulator frequencies from `kcps`, `xcar`, and `xmod`, with `kndx` as the modulation index.
- For more than one FM modulator/operator, do not stack multiple audible `foscili` layers as a substitute. Build the FM graph explicitly with `oscil3`: convert or provide the carrier base frequency at audio rate, generate each modulator with `oscil3`, scale each modulator by its frequency deviation (`mod_index * modulator_frequency`, equivalent to max frequency deviation), sum the modulators, and feed the result into the carrier `oscil3.freq`.
- Scale source amplitude with velocity and envelope before sound generation.
- Use `pan2` to distribute mono signals to left/right.
- End every generated graph with exactly one `outs` node.

## Error Handling

When a CLI command fails, read the structured `error.retry` field and adjust the spec or backend URL. Do not update an existing patch after failed validation or failed compile preflight.
