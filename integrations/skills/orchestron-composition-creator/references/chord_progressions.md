# Choosing chord progressions

Read this when choosing harmony for a brief, exploring an emotional direction,
or reharmonizing a selected melody. Emotional labels are listening hypotheses:
melody, rhythm, voicing, sound, cultural context and the listener affect the result.
Agree on a direction such as “restless verse, reassuring arrival” rather than
treating a chord sequence as a guaranteed emotion.

## Starting points from Native Instruments

These seven associations are condensed from Reuben Cornell's
[Native Instruments article](https://www.native-instruments.com/blogs/blog/emotional-chord-progressions)
(23 May 2023). The choosing workflow and worked study below are Orchestron
authoring guidance, not examples transcribed from the article's songs.

| Emotional starting point | Progression | Concrete chords |
| --- | --- | --- |
| Joy, energy | I–V–vi–IV | C–G–Am–F |
| Brooding | i–bVI | Am–F |
| Nostalgia | I–IV–ii–V | C–F–Dm–G |
| Determination | ii–I–V | Dm–C–G |
| Relaxation | i–bVII–v–bVI | Am–G–Em–F |
| Longing | i–bIII–bVII–iv | Am–C–G–Dm |
| Aggression | i–bVII–i–bVII–bVI–bVII–i | Am–G–Am–G–F–G–Am |

The article also suggests rotating C–F–Dm–G to F–Dm–G–C, repeating a short
fragment before expanding it, and trying Dm7 at the end of the longing sequence.
Treat its mood descriptions as prompts for comparison, not automatic labels.

## Read the notation consistently

Here, Roman-numeral roots are measured against the tonic's **major scale**, even
in minor. Uppercase means major and lowercase means minor; `b` lowers the root
one semitone. Thus in A minor, `bIII = C`, `bVI = F`, `bVII = G`, `v = Em`, and
`V = E` with G-sharp. Unqualified chord names such as C mean major triads.
The article instead writes III/VI/VII for those natural-minor chords; the pitches
in the table are unchanged. State the key when transposing: C–G–Am–F becomes
D–A–Bm–G in D major, preserving I–V–vi–IV.

These are analytical labels, not guaranteed CLI tokens. Roman-numeral parsers
can interpret accidentals relative to the supplied mode. For imports, resolve
the actual pitches or explicit root/chord labels and verify them; do not blindly
paste `bVI` into a minor-mode `progression` field.

## Choose by musical purpose

1. **Decide what the section must do.** A repeating state, an unanswered phrase
   and a final arrival need different endings. Use the two-chord option when
   the melody needs room; shortlist a longer loop when its changes help mark
   phrases. For a groove-centered brief, a pedal or one chord remains a valid
   choice. Do not force four-chord songwriting onto ambient or techno material.
2. **Check the melody before decorating the chords.** Inspect long notes and
   accented notes at each change. Identify chord tones, intended extensions and
   notes needing resolution. A sustained E over Dm can be an intentional ninth;
   audition its register and duration instead of automatically changing E to F.
   Preserve accepted melody notes unless the user requests melodic revision.
3. **Choose where home becomes audible.** In C major, stopping on G leaves V;
   returning to C supplies the tonic arrival. A phrase ending on V is a half
   cadence, not a tonic resolution. V–I/i, V–vi and IV–I offer different degrees
   and kinds of closure; rhythm and melodic endings still matter. See
   [Hutchinson's cadence comparison](https://musictheory.pugetsound.edu/mt21c/PeriodForm.html).
4. **Set harmonic rhythm explicitly.** Begin an audition with one chord per bar,
   then test holding the first chord for two bars or placing two changes in the
   last bar. Keep the phrase's total duration equal when comparing. Faster
   changes can increase activity; fewer changes can give a hook more space.
   For a seven-chord sequence, specify durations rather than assuming eight bars.
5. **Compare alternatives that answer one question.** Keep melody, tempo, meter,
   sound, gain and accompaniment rhythm fixed initially. Change the ending,
   bass or one chord quality, then ask which supports the intended section.
   Listen through the last-to-first transition as well as the internal changes.
   Record the listener's reason and selection before developing or exporting.

## Adjust color without losing the phrase

These are additional experiments, not emotion presets:

| Question | Concrete experiment | What to listen for |
| --- | --- | --- |
| Does the ending need a stronger pull home? | In A minor, compare Dm–Em–Am with Dm–E–Am. | G-sharp in E can approach A by semitone; check for clashes with a held G-natural melody. |
| Does the return feel too predictable? | In C major, compare Dm–G–C with Dm–G–Am. | The second destination delays the expected tonic arrival; it does not make the song universally sad. |
| Could one borrowed chord add contrast? | Compare C–F–C with C–Fm–C. | The A-flat in Fm introduces parallel-minor color; keep the melody compatible or make its friction deliberate. |
| Does the bass jump distract from the tune? | Over C–Am7, retain upper C4/E4/G4 while changing bass C3 to A2. | The second sonority is Am7; common tones can connect different roots. |
| Would more color help? | Compare C–Am with Cmaj7–Am7 at the same register and level. | Added B and G change the melody's interval relationships; more notes need not improve the phrase. |

Separate root motion from voicing. Moving a chord's notes between octaves changes
spacing; changing its lowest chord tone creates an inversion. Keep a distinct
bass part clear and avoid crowding low thirds. Use explicit voices when a chosen
inversion, omitted tone or extension matters. For dance sections, audition with
kick and bass before retaining dense upper chords. For an ambient section, test
longer holds and fewer cadential arrivals. These choices supplement the
Performance Creator's genre and arpeggiation guidance.

## Worked comparison: modal continuity or a directed return

Create two original four-bar studies in A minor, 4/4, 96 BPM. Hold one chord per
bar. The shared melody is E5, F5, B4, A4, one whole note per bar; use channel 1
for it and channel 2 for accompaniment. The only difference is G4 versus G-sharp4
in bar 3, so the comparison isolates the minor/major dominant choice.

| Bar / onset in quarter notes | Melody / MIDI | Bass / MIDI | Upper accompaniment / MIDI |
| --- | --- | --- | --- |
| 1 / 0 | E5 / 76 | A2 / 45 | C4–E4–A4 / 60, 64, 69 |
| 2 / 4 | F5 / 77 | D3 / 50 | D4–F4–A4 / 62, 65, 69 |
| 3 / 8, modal option | B4 / 71 | E3 / 52 | B3–E4–G4 / 59, 64, 67 |
| 3 / 8, directed option | B4 / 71 | E3 / 52 | B3–E4–G#4 / 59, 64, 68 |
| 4 / 12 | A4 / 69 | A2 / 45 | C4–E4–A4 / 60, 64, 69 |

The progressions are i–iv–v–i and i–iv–V–i. Each candidate uses only one bar-3
row. Keep velocities identical between candidates, for example melody 84 and
accompaniment 56. Listen for continuity versus a more directed G-sharp-to-A
return, then ask which fits the brief. Either can support different emotional
readings. For an existing selected melody, preserve that melody instead of
substituting this teaching example.

## Author and hand off in Orchestron

Use the [working score contract](score_and_handoff.md) for changing progressions:
write each sounding pitch as an event with `pitch_midi`, rational `onset_qn` and
`duration_qn`, and velocity. In the study, use `length_qn: "16"`, onsets `"0"`,
`"4"`, `"8"`, `"12"`, and duration `"4"`. Put the melody first; bass and upper
chord notes can share the accompaniment part because their pitches are distinct.
The global mode can remain `aeolian` while explicit pitches carry G-sharp.

The built-in `compare-harmony` command compares two **static diatonic settings**
held for the whole phrase; it does not sequence these chord changes. Use it for
the experiment described in [motif comparisons](motif_comparisons.md). For a
changing or chromatic progression, author new score copies and import each with
`import-score SESSION FILE --from ACCEPTED_ID`. Preserve melody, locks and other
parts, record the actual accompaniment edits through
[creation history](creation_history.md), and include `--trace FILE`. Fresh studies
without an accepted parent omit `--from`. Candidates still need the user's
listening selection; the guide adds no automatic emotion-selection command.

Export accepted candidates through the normal workflow. Performance Creator
preserves the accepted notes and timing when assigning instruments and devices;
it does not reharmonize a handoff unless asked. Repeating chord patterns normally
use Melodic Sequencers. Exact voicings export as independent melodic voices;
use [chord syntax](../../orchestron-performance-creator/references/chord_syntax.md)
and [score specs](../../orchestron-performance-creator/references/score_spec.md)
when authoring directly there. Do not invent unsupported add9, slash-chord or
arbitrary-note-array fields to encode an exact voicing.
