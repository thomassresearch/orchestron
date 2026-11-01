---
name: orchestron-performance-creator
description: Create, edit, import, validate, save, and live-test Orchestron performances through orchestron_cli, choosing suitable sequencers and reusable patterns, including custom drum hits and velocities, mixer and Master routing, MIDI automation, per-note timing, strumming, ratchets, and per-instance perf_controller settings.
---

# Orchestron Performance Creator

Use this skill to create or edit Orchestron performances through the skill-local `orchestron_cli` command. The CLI talks only to the running FastAPI backend; never edit SQLite directly.

## CLI Entry Point

Resolve this skill's directory from the location of this `SKILL.md`, whether it is
in a plugin installation, a standalone installation, or a repository checkout.
Python 3.13 and `uv` are required; first use installs the locked dependencies.
From that directory:

```bash
uv run --locked orchestron_cli --api-url http://localhost:8000/api -h
```

From another working directory, add `--project "/absolute/path/to/this-skill"`
to `uv run --locked`. Prefer running from the user's music working directory:
the CLI stores edit sessions in `.orchestron/` relative to the working directory.
When running from the installed skill directory, pass
`--session-file /absolute/path/to/work/edit-session.json` on every edit command.
Keep authored scores outside the installed skill and use absolute score paths.

Repository development example, from the repository root:

```bash
uv run --locked --project integrations/skills/orchestron-performance-creator orchestron_cli --json health
```

or use the thin wrapper:

```bash
uv run --locked --project integrations/skills/orchestron-performance-creator \
  python integrations/skills/orchestron-performance-creator/scripts/orchestron_cli.py --json health
```

Use `--json` for agent-readable output (`{"ok":true,"result":...}`) and structured `error.retry` hints:

```bash
uv run --locked orchestron_cli --json health
```

If the backend is not running, ask for the correct `--api-url` or whether to start it with `make run` from an available Orchestron repository checkout. The plugin contains the client tools, not the backend application.

## Workflow

1. Check backend health.
2. List/import patches as needed.
3. If composing new material, choose the musical brief before writing notes: ambient state, techno process, trance wave, or Goa/psy rise. For interactive melodic exploration, use `orchestron-composition-creator` first. When realising its accepted score, preserve the supplied notes and arrangement and use its channel-to-part mapping to choose instruments. Choose each part's device using the table below before generating lane data.
4. Start an edit session from an existing performance or a new draft.
5. Add instruments first, then run `edit instruments list` to discover their stable binding IDs and audio ports.
   For per-performance sound customization, read `references/performance_controllers.md`, discover the patch's controller node IDs, and stage overrides using `edit performance-controllers set`.
6. Read `references/effect_routing.md` and `references/mixer.md` to connect main outputs and sends and set strip/return/Master levels. The built-in `$master` needs no patch or rack instance. Use the optional `edit add-standard-effects --send-gain-db -12` only when the user wants dry instruments and reverb feeding a compressor into Master; read `references/standard_effect_patching.md` first. Effects are not mandatory.
7. Add sequencers/controllers/arpeggiators with explicit flags or a YAML/JSON score spec.
   For custom percussion, use `edit add-drummer --hits` / `--pad-hits` or drummer `hits` in `edit apply-score`; read [custom drum patterns](references/drummer_patterns.md). Preset grooves are optional starting points, not a limitation to work around with Score Sequencers.
   For long polyphonic Score Sequencers, use `edit add-score-sequencer --spec PATH`; read [Score Sequencer authoring](references/score_sequencer.md). This dedicated format keeps existing composition-score interpretation unchanged.
   Read [score specs](references/score_spec.md) for composition handoffs: `edit apply-score` accepts v1/v2, per-event velocity and local track timing. V2 checks explicit event boundaries and overlaps. Independent voices use separate melodic tracks on the same instrument channel, preserving GUI-compatible note/chord cells. Apply a whole-song score once to a fresh staged draft; the command appends tracks.
   For selected early/late notes or syncopated patterns, read [per-note timing](references/step_timing.md). Use `edit sequencers list` to discover tracks, then `edit step-timing list|set|reset` to inspect or adjust individual melodic steps and drum hits.
   For drum rolls, read [drummer ratchets](references/step_ratchets.md). Use `edit ratchets list|set|reset` or score `step_ratchets` to set 1–8 hits with optional final velocity. These edits preserve cell activation.
   For strummed chords, read [melodic strumming](references/step_strum.md). Use `edit strum list|set|reset` or score `step_strum` / inline event and progression fields. Direction is off/up/down; spread is 0–100% of one local step, with each note retaining its duration.
8. Check that each lane uses a suitable editor, repeating material reuses pads/groups, and accepted notes, velocities and timing remain intact. Then run `edit validate`; this asks the backend to resolve every source outlet to its target inlet and rejects missing ports, invalid targets, and feedback loops.
9. Commit only after validation succeeds.
10. For live testing, use `edit create-runtime --start`. After rack, patch-definition, or route changes, use `edit rebuild-runtime`; use `edit push-runtime` when only sequencer, mixer, or performance-controller values changed. Always-on instruments need a rack restart to adopt controller changes.

## Choose a Device per Part

Respect an explicit user choice. When editing an existing performance, preserve its devices unless changing them is part of the request.

| Musical material | Preferred device |
| --- | --- |
| Drum kit, kick, percussion, grooves and fills | Drummer Sequencer: MIDI-key rows, individual hit velocities, timing and ratchets |
| Repeating bass, riffs, lead motifs, chord patterns or explicitly composed arpeggios | Melodic Sequencer: reusable note/chord/HOLD pattern pads |
| Notes generated by cycling a held chord | Arpeggiator, when that generated behavior matches the intended part |
| Long passages, independently timed overlapping voices, or note durations that the step grid cannot preserve | Score Sequencer, for that part only |
| Parameter movement | Controller Sequencer or MIDI controller |

Song duration is not a device-selection criterion. Melodic and Drummer pads hold 1–16 local beats; build longer phrases and sections from pads, groups and super-groups in the arranger. Reuse identical patterns and reserve variations/fills on other pads before adding lanes just to gain more pad slots.

Give a musical or timing reason when choosing Score over a pattern device. A common timestamped-note input format alone is not a reason to use Score for all parts. Do not quantize accepted material silently to fit a preferred device; use local subdivision/timing controls or retain Score for the affected passage when exact preservation requires it.

A composition **score document** passed to `edit apply-score` is not a **Score Sequencer**: its track `type` selects melodic, drummer, controller or arpeggiator authoring. `edit add-score-sequencer --spec` uses a separate sparse-note format. Check the part's role during handoff rather than inferring its device from the word “score”.

## Core Commands

```bash
uv run --locked orchestron_cli --json patches list
uv run --locked orchestron_cli --json patches formulas set "Lead Patch" --target filter.xcf --expression "0.1 * in1"
uv run --locked orchestron_cli --json performances list
uv run --locked orchestron_cli --json edit begin --new --name "Agent Sketch"
uv run --locked orchestron_cli --json edit add-instrument --patch "TB303" --channel 2 --binding-id bass
uv run --locked orchestron_cli --json edit instruments list
uv run --locked orchestron_cli --json edit performance-controllers list --binding bass
# Use an actual node ID reported by the preceding command:
uv run --locked orchestron_cli --json edit performance-controllers set --binding bass --node attack --value 0.04
uv run --locked orchestron_cli --json edit performance-controllers reset --binding bass --node attack
# Optional preset, after confirming the reverb/compressor patches exist:
uv run --locked orchestron_cli --json edit add-standard-effects --send-gain-db -12
uv run --locked orchestron_cli --json edit routes list
uv run --locked orchestron_cli --json edit mixer list
uv run --locked orchestron_cli --json edit mixer strip set --binding bass --gain-db -6
uv run --locked orchestron_cli --json edit mixer strip set --binding '$master' --gain-db -3
uv run --locked orchestron_cli --json edit add-melodic --channel 2 --steps "s0=C3:min7/4s s4=F3:dom7/4s"
uv run --locked orchestron_cli --json edit sequencers list
# Replace voice-1 with the melodic track ID reported above:
uv run --locked orchestron_cli --json edit strum set --track voice-1 --pad 1 --step 0 --step 4 --direction up --spread 40
uv run --locked orchestron_cli --json edit add-melodic --channel 2 --grid-pattern "C3 . . ." --pad-grid-pattern "2=F3 . . ." --pad-loop "A P4 A" --pad-loop-group "A=1 2"
uv run --locked orchestron_cli --json edit add-drummer --channel 10 --groove backbeat
uv run --locked orchestron_cli --json edit add-drummer --channel 10 --hits "35@0:115 38@4:98 54@7:65" --pad-hits "2=35@0:120 38@12:105" --pad-loop "1 1 1 2"
uv run --locked orchestron_cli --json edit validate
uv run --locked orchestron_cli --json edit commit
uv run --locked orchestron_cli --json edit create-runtime --start
```

Pattern-pad and pad-loop CLI syntax:

- `--pad 1..8` assigns the primary `--steps`, `--grid-pattern`, `--groove`, `--hits`, or `--curve` to that pad.
- Repeat `--pad-steps`, `--pad-grid-pattern`, `--pad-groove`, `--pad-hits`, or `--pad-curve` as `PAD=VALUE` to define additional pads.
- Use `--pad-loop "1 2 P4 1"` for root pad-loop sequences. Pad tokens are `1..8`; pause tokens are `P1`, `P2`, `P4`, `P8`, and `P16`.
- Use repeated `--pad-loop-group "A=1 2"` and `--pad-loop-super-group "I=A A"` for nested sequences.

## References

CLI and data formats:

- For melodic step/chord syntax, read `references/chord_syntax.md`.
- For YAML/JSON score specs, read `references/score_spec.md`.
- For custom drum keys, hits, velocities and per-pad patterns, read [custom drum patterns](references/drummer_patterns.md).
- For early/late notes, syncopated patterns, CLI timing inspection/editing, and score timing fields, read [per-note timing](references/step_timing.md).
- For drummer rolls, velocity ramps, `edit ratchets` commands and score `step_ratchets`, read [drummer ratchets](references/step_ratchets.md).
- For melodic chords played low-to-high or high-to-low, tempo-synced spread, `edit strum` commands and score fields, read [melodic strumming](references/step_strum.md).
- For `perf_controller` discovery, per-instance overrides, reset, persistence, exports, and live updates, read `references/performance_controllers.md`. These I-rate instrument settings are separate from MIDI CC controllers and controller sequencers.
- For patch graph input formulas such as `0.1 * in1`, read `references/patch_formulas.md`.
- For main/send routing, port discovery, Master, direct output, validation, and runtime replacement, read `references/effect_routing.md`.
- For strip/return/Master gain, balance, mute/solo, stereo send updates, and the TB303 Demo walkthrough, read `references/mixer.md`.
- For the optional reverb/compressor preset through Master, read `references/standard_effect_patching.md`.

Composition and genre guidance:

- For choosing chord progressions, emotional tendencies and concrete audition examples, read the shared [Composition Creator progression guide](../orchestron-composition-creator/references/chord_progressions.md). If skills are installed separately, resolve that reference from the available `orchestron-composition-creator` skill. Apply it when composing or when reharmonization is requested; preserve accepted composition handoffs.
- For the end-to-end pattern-based writing process, read `references/composition_workflow.md`.
- For groove, syncopation, phrase lengths, pad-loop hierarchy, and layer roles, read `references/rhythm_layering.md`.
- For chord color, voicing, bass relationships, and arpeggiator use, read `references/harmony_arpeggiation.md`.
- For ambient, techno, trance, Goa trance, and psytrance blueprints, read `references/genre_blueprints.md`.

## Error Handling

When a command fails, read the structured `error.retry` field and adjust the next command. Do not commit after a failed validation. Use `--debug` only when backend response details are needed.
