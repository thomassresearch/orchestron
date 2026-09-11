# Graph Rules

The CLI generates Orchestron patch graph JSON compatible with `backend/app/models/patch.py`.

For original, detailed Csound opcode documentation, start at https://csound.com/docs/manual/PartReference.html.

## Required Spine

Every generated patch includes:

1. `cpsmidi`: reads the played MIDI note pitch.
2. `const_i` with value `1.0`: feeds `ampmidi.iscal`.
3. `ampmidi`: reads played MIDI velocity.
4. I-rate sources for attack, decay, sustain, and release: generated `const_i` defaults or explicitly requested `perf_controller` nodes feed the required `madsr` ADSR inputs.
5. `madsr`: generates the main amplitude envelope.
6. `k_mul`: combines velocity amplitude and envelope.
7. Source layer opcodes.
8. Optional `mix2` nodes when there is more than one layer.
9. Optional mono effect chain.
10. `pan2`: converts mono to left/right audio.
11. **Stereo Output**: final mapped pair of `outleta` nodes.

## Required Invariants

- The generated graph must contain exactly one Stereo Output group and no direct `outs` node.
- The final two nodes in `graph.nodes` must be its `outleta` members, with literal `params.sname` values `left` and `right` in that order.
- Connect `pan2.aleft` to `output_left.asignal` and `pan2.aright` to `output_right.asignal`.
- Both audio inputs must be connected; neither outlet may feed a downstream node.
- Channel names belong directly on the outlets. Do not add `const_s` naming nodes, `sname` connections or formulas.
- Source amplitudes must be scaled by `ampmidi` and `madsr`.
- Pitch-aware sources must receive `cpsmidi.kfreq`.
- `ampmidi.iscal` must be connected from `const_i.iout` with value `1.0`.
- `madsr.iatt`, `madsr.idec`, `madsr.islev`, and `madsr.irel` must each be connected from `const_i.iout` or `perf_controller.iout`. A K-rate MIDI controller is not a substitute for these initialization inputs.
- `perf_controller` has no input connections. Its fixed configuration must be valid; see [performance controllers](performance_controllers.md). Keep controller node IDs stable so saved instance overrides continue to match.
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
- `output_left`
- `output_right`

Layer IDs from the spec are slugified and used as node ID prefixes.

## Stereo Output Representation

Stereo Output is the editor's unified view of two ordinary `outleta` nodes. The catalog name `__stereo_output` is a creation command and must never appear in saved `graph.nodes`. Add this metadata alongside the outlet nodes and their connections:

```json
{
  "audio_interface": {
    "role": "instrument",
    "groups": [{
      "id": "main-output",
      "name": "Stereo Output",
      "direction": "output",
      "layout": "stereo",
      "ports": ["left", "right"],
      "purpose": "main"
    }],
    "mainOutput": "main-output",
    "guided": true
  },
  "ui_layout": {
    "audio_blocks": {"main-output": true}
  }
}
```

Group ports are exact channel names, not node IDs. Preserve other `ui_layout` fields such as `input_formulas`. In Perform, route this named stereo output through the mixer to Master.

## Layout

Generated nodes include deterministic `position` values. The layout is functional rather than hand-designed; users can rearrange nodes in Instrument Design after creation.

## Compile Validation

Local graph invariant validation is not a substitute for backend compile validation. Use `--compile` for create/update whenever the patch is meant to be playable.
