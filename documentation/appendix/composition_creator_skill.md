# Orchestron Composition Creator Skill

Use [Orchestron Composition Creator](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/orchestron-composition-creator/SKILL.md)
to explore melodies by listening, choosing and developing related ideas. It uses
music21 and an arvo compatibility copy, runs independently of the Orchestron
backend, and exports a machine-readable score for Performance Creator.

![Three melodic candidates in the composition audition page, with playback, favourites, feedback and locked ranges](../../screenshots/composition_audition.png)

## Try It With an Agent

> Read `integrations/skills/orchestron-composition-creator/SKILL.md`. Propose three
> two-bar melodies in D dorian at 108 BPM, with a calm but slightly syncopated
> character. Include quiet harmony for comparison. Open the audition page and
> wait for my choice. Develop the melody I select, preserving any passages I lock.
> When I accept the phrases, export a score for Orchestron Performance Creator.

The agent creates a session and generates a small shortlist. Each candidate has
a contour display and a player. Compare **With harmony** and **Melody only**, loop
the phrase, or download its MIDI. All candidates use consistent preview sound and
gain. The default simple MIDI synthesizer needs no extra sound installation;
FluidSynth with a local SoundFont is optional. Preview timbre differs from the
instrument eventually chosen in Orchestron.

## Choose and Continue

Mark **Keep**, **Favourite**, **Reject** or **Undecided**, add feedback, and click
**Save selection**. To retain an opening, enter a melody lock such as `0:4` for the
first four quarter notes. Multiple ranges use commas. Complete notes touching a
locked range remain unchanged. Locks protect the melody; built-in development
also leaves its existing harmony intact.

Return to chat and say **“continue”**. The agent reads the saved selections and
creates related ideas. It can transpose or invert a motif, develop cyclic or
additive material, combine one accepted idea's pitches with another's rhythm,
or append a continuation. Feedback guides the agent; the command-line generator
does not interpret prose by itself. Saving in the page does not start generation.

Use **Refresh ideas** to see the next round. Earlier rounds, comments and choices
remain available. The page works in English, German, French and Spanish. Unsaved
changes are marked. A conflicting newer revision must be refreshed before saving.
The session is stored locally and can be resumed after closing the page.

## Local Commands

From the repository root:

```bash
uv run --locked --project integrations/skills/orchestron-composition-creator \
  orchestron_compose init output/composition/quiet-currents \
  --title "Quiet currents" --key D --mode dorian --tempo 108 --bars 2
uv run --locked --project integrations/skills/orchestron-composition-creator \
  orchestron_compose generate output/composition/quiet-currents
uv run --locked --project integrations/skills/orchestron-composition-creator \
  orchestron_compose serve output/composition/quiet-currents
```

Open the printed loopback URL. Stop the server with Ctrl-C when finished; saved
choices remain on disk. The tools require Python 3.13 and `uv` on macOS or Linux.
Dependencies are downloaded on first use and locked for repeatability.

## Export and Realise the Song

Ask the agent to arrange accepted phrases in a specified order. Export includes
`composition.json`, `orchestron-score.json`, MIDI, MusicXML and playable WAV files.
The canonical score retains exact rational timing, note dynamics, phrase sections
and accepted-candidate provenance. The exporter finds exact supported grids and
creates editable voice tracks and pads; it reports unsupported timing or capacity
instead of silently changing the music. Initial scope is fixed tempo/meter and
standard MIDI pitches, with straight/triplet grids and supported subdivisions.

[Performance Creator](performance_creator_skill.md) then discovers instruments,
maps the score's channels, sets routing and mixer levels, applies the score,
validates and saves the performance. These score files are not native Orchestron
bundles and should not be passed to the application's Import dialog.

## Kurzablauf · Résumé · Resumen

**Deutsch:** Ideen anhören, **Behalten/Favorit** wählen, Feedback und geschützte
Melodieabschnitte speichern. Zum Chat zurückkehren und „weiter“ sagen. Anschliessend
**Ideen aktualisieren**. Der Agent exportiert die ausgewählten Phrasen für Performance Creator.

**Français :** Écoutez les idées, choisissez **Garder/Favori**, puis enregistrez vos
commentaires et passages protégés. Revenez au chat et dites « continuer », puis
actualisez les idées. L'agent exporte les phrases acceptées pour Performance Creator.

**Español:** Escucha las ideas, elige **Conservar/Favorito** y guarda los comentarios
y pasajes protegidos. Vuelve al chat y di «continuar»; después actualiza las ideas.
El agente exporta las frases aceptadas para Performance Creator.
