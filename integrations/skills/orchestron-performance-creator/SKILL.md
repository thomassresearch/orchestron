---
name: orchestron-performance-creator
description: Create, inspect, edit, validate, save and audition Orchestron performances with reusable clip definitions, repetitions, scoped transposition, instrument-bound automation, structural editing and undo. Use orchestron_cli for instrument assignments, routing, mixer and exact Composition Creator score handoffs.
---

# Orchestron Performance Creator

Use the skill-local `orchestron_cli`. It communicates with the FastAPI backend;
never edit SQLite. Local song operations also work offline.

## Run from the music directory

Resolve the skill directory from this SKILL.md. Python 3.13 and uv are required.
Keep song files, edit sessions and exports outside the installed plugin:

```bash
uv run --locked --project /absolute/path/to/orchestron-performance-creator orchestron_cli --json capabilities
```

The thin `scripts/orchestron_cli.py` wrapper is also supported. Pass
`--api-url http://localhost:8000/api` for a different server, and
`--session-file /absolute/path/to/work/edit.json` when needed. Default sessions
are in `.orchestron/` under the working directory. A read-only installation can
use `UV_PROJECT_ENVIRONMENT=/absolute/path/to/work/venv` outside the plugin.
The plugin supplies clients, not the backend. `capabilities --offline` reports
client formats and leaves backend support unknown. Check the advertised CLI
version to detect stale installations before relying on a new command.

Use `--json` before commands. Responses retain `ok` and `result` and add
`schemaVersion: 1`. Read returned IDs, scope, count changes, revisions,
validation layers and retry hints. Staged, saved and audible state are distinct.

## Workflow

1. Check capabilities and discover patches/performances. Establish the musical
   brief and device choices. Respect requested instruments and accepted notes;
   use Composition Creator first for interactive melodic/harmonic exploration.
2. For a new song run `edit begin --new --arranger clips --name NAME`.
   `--offline` is available for initial composition. To revise a saved song use
   `edit begin --performance NAME_OR_ID`. Legacy songs remain legacy unless
   explicitly migrated with a verified recovery file.
3. Add instrument bindings, inspect their IDs/ports, then route outputs and set
   mixer levels. The fixed `$master` needs no patch or rack slot. Read the
   routing/mixer references; optional effects are a musical choice.
4. Read [song workflow](references/song_workflow.md) and
   [schema/time](references/song_schema.md). Define each musical motif once,
   then use clip references and scalar repeats. Use `edit apply-song --file PATH`
   for a whole-song JSON/YAML document or incremental lane/pattern/clip commands.
   Start from [minimal](assets/minimal-song.json) or [128 bars](assets/complete-song.json).
   Use `edit adapt-score --file PATH --id HANDOFF` for accepted Composition Creator
   v1/v2 documents; do not reinterpret their notes or use append retries.
5. For pitch-only variation use shared, parent or placement transposition plans.
   Fork musical definitions only for intentional note/rhythm/dynamics changes.
   Groups are lane-local; sections coordinate song time across selected lanes.
   Clip libraries are not limited to eight pads.
6. For an instrument sweep read [automation](references/song_automation.md),
   discover controller nodes/mappings, generate owned lanes and edit one long
   curve. MIDI channel and CC follow the rack instance. Fixed `perf_controller`
   settings remain separate per-instance I-rate values.
7. Inspect summary, definitions, clips and occurrence trees. Use returned
   revision/fingerprint targets for scoped edits. Read
   [editing/history](references/song_editing.md) for cell edits, structural edits,
   sections, batch transactions, dry runs and undo. Check that original notes,
   hidden cells, unused definitions, trailing silence and sharing are retained.
8. Run `edit validate` online, then `edit commit`. Offline validation checks only
   authored content. Online validation also resolves routing; audio preparation
   is a separate runtime operation. A stale saved version fails rather than
   overwriting another writer. Unsaved GUI editor drafts are not visible here.
9. Build or attach a runtime. Use `edit push-runtime` for ordinary music/mixer/
   controller edits, `edit rebuild-runtime` for topology changes. Audition the
   returned occurrence with `edit audition start --target PATH --scope full`
   (or `cropped`), inspect status, then stop. Push the intended draft first;
   audition refuses a mismatched runtime. Do not equate accepted preparation
   with speaker output. Native and MIDI/SCORE exports use `edit export`.

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

## Legacy compatibility

The eight-pad commands (`add-melodic`, `add-drummer`, `add-score-sequencer`,
`apply-score`, `step-timing`, `ratchets`, `strum`, pad-loop flags) remain for
legacy sessions. They cannot mutate clip-owned shadow pads. New clip workflows
use definitions and `patterns cells`; the detailed legacy references are labeled.
Run `edit migrate --dry-run` before explicitly converting a supported legacy
arrangement with `edit migrate --recovery /work/original.json`.

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

## Recovery

Read structured errors and their paths before retrying. Inspect again after a
stale target; choose a free window after collision. Reapply identical song
inputs to confirm a no-op. Do not commit a failed validation. Use `--debug` for
raw backend details, and runtime status after interrupted remote operations.
