---
name: orchestron-composition-creator
description: Compose and develop melodies through an interactive listen-select-refine workflow using music21 and arvo, with playable MIDI previews, saved candidate branches, locked passages, and machine-readable scores for Orchestron Performance Creator. Use for melodic idea exploration and algorithmic composition; use Performance Creator for instrument assignment, routing and saving performances.
---

# Orchestron Composition Creator

Use the skill-local `orchestron_compose` CLI to generate, audition, develop and
export music. It runs locally without an Orchestron backend. Read
[workflow and commands](references/workflow.md) for the interactive loop, and
[score and handoff](references/score_and_handoff.md) before authoring custom
material or exporting. [Compatibility](references/compatibility.md) explains
the bundled arvo fixes and preview dependencies.
Read [creation history](references/creation_history.md) when explaining a candidate
or authoring custom material; it covers the recorder and portable ancestry.

## Entry point

From this skill directory:

```bash
uv run --locked orchestron_compose --help
```

From the repository root:

```bash
uv run --locked --project integrations/skills/orchestron-composition-creator \
  orchestron_compose --help
```

Use a durable session directory outside the skill package, such as
`output/composition/my-song` from the repository root. Commands return JSON;
errors go to stderr with a nonzero exit status. A foreground `serve` command
prints its loopback URL and stays running until stopped. Open that exact URL
in the user's browser. Keep the process available while they audition.

## Conduct the listening workflow

1. Establish the brief: character, tonal/modal language, tempo, meter, register,
   phrase length, and whether harmony helps comparison. Infer reasonable defaults
   and ask only about choices that materially affect the music. The CLI's seeded
   starters are a starting point; use the score contract to author more specific
   motifs or harmony when the brief needs it.
2. `init` a session, then `generate` a shortlist of up to four ideas. Previews are
   rendered automatically. Present the `serve` page and briefly describe the
   musical differences. Candidates use the same preview instrument and gain.
3. **Wait for the user's selection.** Do not choose Keep/Favourite on their
   behalf or treat listening, silence, elapsed time, or a pending candidate as
   acceptance. The page persists decisions, feedback, and locked melody ranges.
   Tell the user to save, return to chat, and say “continue”. A page click does
   not wake the agent. Chat selections can be recorded with `review`.
4. Read `status` after each response. Use an accepted `--from` candidate to
   develop its motif. Honour feedback when choosing the operation or authoring a
   revised score. Use `--rhythm-from` to combine two accepted ideas. Never assume
   free-text feedback is automatically interpreted by the generator.
   Import custom revisions with `import-score --from ACCEPTED_ID` to verify and
   inherit the parent's locks and record its lineage.
   For custom scripts, capture musical calls with `Recorder.call`, describe authored
   changes with `Recorder.authored`, and supply `--trace FILE` on import. Declare
   every contributing candidate and its role. Record actual inputs/outputs while
   working; never infer an unrecorded operation from the resulting notes.
5. Preserve locked passages. Locks are half-open quarter-note ranges on the
   **melody**; complete intersecting notes, their velocities, and silence inside
   the ranges are protected. Harmony stays unchanged during development. Use
   `continue` for an appended answering phrase, or export an ordered list of
   accepted candidates to assemble larger form. Offer fresh ideas only when asked.
6. Export the accepted order, including deliberate repetitions. Audition the
   assembled `mix.wav`; include the exported score's exact path in the handoff.
   If a conversion fails, explain the unsupported musical feature and revise it
   with the user. Never silently quantize, shorten, or omit accepted notes.

## Musical decisions

Build identity through motifs, recurrence, clear contour and cadences. Develop
related phrases using scalar sequence/inversion, rhythmic contrast, fragmentation,
isorhythm, or additive/subtractive processes. Use arvo's tintinnabuli when its
triadic relationship fits the brief. Control range and density; avoid adding
layers to conceal an unconvincing motif. Compare melody alone and with harmony.
The tool does not guarantee stylistic quality: listening decisions remain central.

## Handoff

Deliver `composition.json` (rational-time working score), `orchestron-score.json`
(Performance Creator score v2), `mix.mid`, `solo.mid`, `score.musicxml`, and
`mix.wav`/`solo.wav`. The score includes accepted candidate IDs and generation
provenance, including the complete recorded creation chain and phrase placements.
Each audition card has a collapsible creation-history panel; `trace SESSION ID`
returns the same ancestry. Older or unrecorded material shows explicit gaps.
These are score artifacts, not native `.orch.json` bundles.

When asked to realise the song, use the available `orchestron-performance-creator`
skill, or the sibling directory's `SKILL.md`. It discovers instruments, binds the
score's channels, sets routes and mix, applies the score, validates and saves.
Its updated importer must support score version 2. Do not invent patch IDs or
write the library database. Sound design and live playback follow that skill's
normal workflow and the user's request.

## Recovery

Resume an existing session with `status` and `serve`; candidate scores are
immutable and reviews are revisioned. `undo` restores the previous session state.
If rendering fails after generation, candidates remain saved: fix the renderer
and use `render`, without regenerating the music. Export uses a new directory and
does not replace earlier exports. Stop the audition server when it is no longer
needed; stopping it preserves every saved selection.
