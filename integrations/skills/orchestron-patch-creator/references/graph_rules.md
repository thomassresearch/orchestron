# Graph Rules

The CLI generates Orchestron patch graph JSON compatible with `backend/app/models/patch.py`.

For original, detailed Csound opcode documentation, start at https://csound.com/docs/manual/PartReference.html.

## Required Spine

Every generated patch includes:

1. `cpsmidi`: reads the played MIDI note pitch.
2. `const_i` with value `1.0`: feeds `ampmidi.iscal`.
3. `ampmidi`: reads played MIDI velocity.
4. `const_i` nodes for attack, decay, sustain, and release: feed the required `madsr` ADSR inputs.
5. `madsr`: generates the main amplitude envelope.
6. `k_mul`: combines velocity amplitude and envelope.
7. Source layer opcodes.
8. Optional `mix2` nodes when there is more than one layer.
9. Optional mono effect chain.
10. `pan2`: converts mono to left/right audio.
11. `outs`: final stereo output.

## Required Invariants

- The generated graph must contain exactly one `outs` node.
- The final node in `graph.nodes` must be `outs`.
- `outs.left` and `outs.right` must both be connected.
- `outs` must not feed any downstream node.
- Source amplitudes must be scaled by `ampmidi` and `madsr`.
- Pitch-aware sources must receive `cpsmidi.kfreq`.
- `ampmidi.iscal` must be connected from `const_i.iout` with value `1.0`.
- `madsr.iatt`, `madsr.idec`, `madsr.islev`, and `madsr.irel` must each be connected from `const_i.iout`.
- `foscili` represents exactly one carrier/modulator FM pair. Multi-operator FM graphs must use explicit `oscil3` operators and audio-rate frequency modulation instead of multiple audible `foscili` layers.

## Node IDs

The CLI uses stable, readable node IDs such as:

- `pitch_cpsmidi`
- `velocity_ampmidi`
- `velocity_scale_const`
- `env_attack_const`
- `env_decay_const`
- `env_sustain_const`
- `env_release_const`
- `amp_madsr`
- `amp_velocity_envelope`
- `output_pan2`
- `output_outs`

Layer IDs from the spec are slugified and used as node ID prefixes.

## Layout

Generated nodes include deterministic `position` values. The layout is functional rather than hand-designed; users can rearrange nodes in Instrument Design after creation.

## Compile Validation

Local graph invariant validation is not a substitute for backend compile validation. Use `--compile` for create/update whenever the patch is meant to be playable.
