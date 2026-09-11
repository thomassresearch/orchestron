---
name: orchestron-patch-creator
description: Use when creating, editing, validating, compiling, or importing Orchestron Instrument Design patches from sound descriptions or structured specs through orchestron_patch_cli, including synthesis, effects, envelopes, opcode input formulas, and perf_controller knobs for per-performance instrument customization.
---

# Orchestron Patch Creator

Use this skill to create or update Orchestron Instrument Design patches, which are instruments. Translate the user's sound description into a structured patch spec, then use the skill-local `orchestron_patch_cli` command to generate graph JSON and create/update the patch through the running FastAPI backend. Never edit SQLite directly.

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
   - `references/performance_controllers.md` for authoring `perf_controller` knobs for per-performance ADSR, distortion, or other instrument settings.
   - Use the original Csound opcode reference at https://csound.com/docs/manual/PartReference.html for detailed opcode semantics when the local reference is not enough.
5. Write a structured patch spec.
6. Use `formulas:` in the spec when an opcode input should scale or combine existing connections without helper opcodes.
7. Run `spec validate`.
8. Run `graph render` if you need to inspect graph JSON.
9. Run `patch create` or `patch update`; use `--compile` unless the patch is intentionally incomplete and saved as a template.

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
- Connect `madsr.iatt`, `madsr.idec`, `madsr.islev`, and `madsr.irel` from I-rate sources: generated `const_i` defaults, or `perf_controller.iout` when the user wants rack customization.
- Use `foscili` only for one carrier plus one modulator. It derives carrier and modulator frequencies from `kcps`, `xcar`, and `xmod`, with `kndx` as the modulation index.
- For more than one FM modulator/operator, do not stack multiple audible `foscili` layers as a substitute. Build the FM graph explicitly with `oscil3`: convert or provide the carrier base frequency at audio rate, generate each modulator with `oscil3`, scale each modulator by its frequency deviation (`mod_index * modulator_frequency`, equivalent to max frequency deviation), sum the modulators, and feed the result into the carrier `oscil3.freq`.
- Use patch spec `formulas:` for simple scaling or combination at an opcode input, for example `0.1 * in1`; formulas are stored in `graph.ui_layout.input_formulas` and compiled like GUI-edited formulas.
- Scale source amplitude with velocity and envelope before sound generation.
- Use `pan2` to distribute mono signals to left/right.
- End every generated graph with one **Stereo Output** block: two `outleta` nodes named `left` and `right`, grouped in `graph.audio_interface` as the main stereo output and collapsed via `graph.ui_layout.audio_blocks`. Connect `pan2.aleft`/`aright` to their respective `asignal` inputs. See `references/graph_rules.md` for the saved representation.
- Stereo Output is an editor construct, not a backend opcode named `__stereo_output`. Do not serialize that catalog command, generate direct `outs`, or leave the output channels ungrouped. Store channel names directly in `params.sname`.
- In Perform, route the Stereo Output through the mixer to Master for playback.

## Performance Customization

Use the Orchestron virtual opcode `perf_controller` for settings that vary between performances or rack instances. Its fixed fields are `min`, `max`, `default`, `scale` (`linear` or `logarithmic`), and `label`; its only output is I-rate `iout`, and it has no input sockets. Add definitions through the patch spec's `performance_controllers` list; see [the schema and working example](references/performance_controllers.md).

Keep node IDs stable when editing a patch: performance overrides refer to those IDs, not labels. Set useful patch defaults, then store instance choices in the performance rather than changing the shared patch. These knobs do not send MIDI CC. New notes read updated values; held notes retain theirs, and always-on instruments need a rack restart. Standalone compilation and isolated audition use defaults.

## Error Handling

When a CLI command fails, read the structured `error.retry` field and adjust the spec or backend URL. Do not update an existing patch after failed validation or failed compile preflight.
