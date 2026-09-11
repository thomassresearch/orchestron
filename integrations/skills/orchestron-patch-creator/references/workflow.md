# Patch Creation Workflow

## 1. Interpret The Sound Description

Convert the user's words into a synthesis family, sources, modulation, envelope, filters, effects, and output behavior. Preserve uncertainty as parameter ranges or conservative defaults; do not invent complex graph structure unless the description requires it.

Common routing clues:

- Warm, analog, saw, square, bass, lead: use `subtractive`.
- Evolving, glassy, bell, metallic, phase modulation, operator: use `fm_pad`.
- Breath, wind, hiss, percussion noise, texture: use `noise_texture`.
- Plain sine, simple tone, test patch: use `simple_osc`.

## 2. Choose The Smallest Family

Start with the smallest family that explains the target sound. Add effects after the source and envelope are plausible. Prefer one or two source layers; add more layers only when the description clearly asks for width, detune, or parallel timbres.

## 3. Write A Patch Spec

Use `references/patch_spec.md`. Keep the spec explicit and readable. Include `name`, `description`, `family`, `envelope`, `layers`, optional `effects`, and `output`.

Add `formulas` only when an opcode input should scale or combine existing generated graph connections. If you are not sure about node IDs, render the graph first, inspect `graph.nodes[].id` and `graph.connections`, then add formula targets such as `osc_vco2.kamp`.

For settings the user wants to tune per performance, add `performance_controllers` with stable IDs, useful ranges and defaults. See [performance controllers](performance_controllers.md). Render first when the target input ID is uncertain. Preserve an existing controller ID when changing its label or range.

## 4. Validate Before Backend Writes

Run:

```bash
uv run orchestron_patch_cli --json spec validate patch.yaml
```

This checks supported families/opcodes and local graph invariants: `cpsmidi`, `ampmidi` with `const_i` scale `1.0`, `madsr` with I-rate constant/controller ADSR inputs, valid controller configurations, mono-to-stereo `pan2`, and a final Stereo Output block with two connected, named outlets and the main stereo mapping. Backend compile preflight also checks controller target ports and signal compatibility.

## 5. Inspect The Graph When Needed

Run:

```bash
uv run orchestron_patch_cli --json graph render patch.yaml --out patch.graph.json
```

Inspect node IDs and connections if the resulting patch might be complex or if compile diagnostics mention missing ports.

This is also the safest way to author input formulas: render once, identify the target input and source connection, then add `formulas:` to the spec and validate again.

## 6. Create Or Update Through The Backend

Run create/update with compile preflight:

```bash
uv run orchestron_patch_cli --json patch create patch.yaml --compile
uv run orchestron_patch_cli --json patch update PATCH_ID patch.yaml --compile
```

Compile preflight creates a temporary patch, compiles it through a temporary session, cleans it up, and only then writes the final patch. If the backend is not running, ask the user whether to start it with `make run`.

The generated Stereo Output exposes `left` and `right` ports. In Perform, route its stereo group through the mixer to Master to deliver audio. Compile success alone does not establish that performance route.

For shared output gain, apply the formula to `output_pan2.asig` before the stereo split. On Csound 6.18, applying matching scaling formulas directly to both outlet inputs can silence the right channel at runtime even though compilation succeeds. Verify both channels when using per-outlet formulas.

## 7. Iterate

If compile succeeds but the sound is not close enough, change source ratios, envelope times, filter cutoff/resonance, gain balance, and effects first. Change template family only when the source family is clearly wrong.
