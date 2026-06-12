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

## 4. Validate Before Backend Writes

Run:

```bash
uv run orchestron_patch_cli --json spec validate patch.yaml
```

This checks supported families/opcodes and local graph invariants: `cpsmidi`, `ampmidi` with `const_i` scale `1.0`, `madsr` with `const_i` ADSR inputs, mono-to-stereo `pan2`, and final `outs`.

## 5. Inspect The Graph When Needed

Run:

```bash
uv run orchestron_patch_cli --json graph render patch.yaml --out patch.graph.json
```

Inspect node IDs and connections if the resulting patch might be complex or if compile diagnostics mention missing ports.

## 6. Create Or Update Through The Backend

Run create/update with compile preflight:

```bash
uv run orchestron_patch_cli --json patch create patch.yaml --compile
uv run orchestron_patch_cli --json patch update PATCH_ID patch.yaml --compile
```

Compile preflight creates a temporary patch, compiles it through a temporary session, cleans it up, and only then writes the final patch. If the backend is not running, ask the user whether to start it with `make run`.

## 7. Iterate

If compile succeeds but the sound is not close enough, change source ratios, envelope times, filter cutoff/resonance, gain balance, and effects first. Change template family only when the source family is clearly wrong.
