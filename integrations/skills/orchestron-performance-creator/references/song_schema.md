# Song schema and exact time

`edit schema` returns the machine-readable `orchestron-song` version 1 schema.
It is separate from Composition Creator score v1/v2, performance v23–26, clip
model v1–4, runtime schedule versions and the native bundle envelope.
The runtime performs additional source-specific and relational checks.

Root fields: `schema`, `version`, `id`, optional `songMeter: [4,4]`, `tempo`,
`end`, `loop`, `instruments`, `lanes`, `automation`. Unknown authoring fields fail.
Use stable IDs across retries. `create` rejects existing unrelated identities;
retrying its identical document is safe. `update` preserves omitted objects;
`replace --scope LANE` replaces only explicitly managed lanes, reports removals,
and requires every supplied lane to be in that scope. Repeat `--scope` as needed.

Each lane has `id`, `source` (`sequencer`, `drummer`, `score`, `controller`,
`arpeggiator`), optional `name`, `channel`, `timing`, `settings`, `definitions`,
`clips`. Lane names are display labels; IDs are exact operation selectors.
Timing uses global tempo and independent `meterNumerator`, `meterDenominator`,
`stepsPerBeat`, `beatRateNumerator`, `beatRateDenominator`.

Definitions have `id`, optional `name`, `kind` (default `pattern`), and `music`
or a source-specific `payload` patch. Container definitions have `children`.
Children are definition-ID strings or objects with `definitionId` or `rest`.
References can have an explicit `id`, additive `transpose` plan and fixed
`repeatIndex`. Groups hold patterns/rests; supergroups hold groups/rests.
Unused definitions are retained and validated.

| Source | Convenient `music` fields | Detailed payload controls |
| --- | --- | --- |
| sequencer | `lengthBeats`, `steps`, `grid`, `velocity`, `scaleRoot`, `scaleType`, `mode` | `steps`: notes/chords/holds, velocities, timing, ratchets, strums |
| drummer | `lengthBeats`, `hits`, `groove` | `rows` with `rowId` and full stored cells |
| score | `lengthBeats`, theory fields, `notes` | Sparse `{id,pitch,velocity,startTicks,durationTicks}` notes |
| controller | `lengthBeats`, `curve` | Both `steps` and `keypoints`; owned `curveDurationTicks` |
| arpeggiator | `lengthBeats` | Rate, pattern, octaves, gate, swing, probability, steps, scale, seed and other editor fields |

Use `edit inspect --view payload --lane ID --definition ID` to discover exact
stored controls, including inactive and hidden data. A payload-only or
length/theory edit retains other fields; a new musical expression replaces its
musical material. Changing a clip window never trims source notes.

Each clip has `id`, optional `name`, `start`, `offset`, `children`, and either
`length` with `mode: once|loop`, or integer `repeat`. `repeat` derives a Loop
window from one content cycle; it never duplicates the definition. Once clips
can retain trailing silence. `repeatIndexBase` and `transposePlacements` are
advanced fields for retained logical repeat identity and exact occurrence paths.

All integer times are transport ticks, with 20,160 ticks per master quarter.
String suffixes: `t` ticks, `b` master quarters, `l` lane-local beats, `bar`
bars in explicit `songMeter`. Fractions such as `3/2b` must resolve to an exact
integer tick; there is no floating-point rounding. Positions are zero-origin.
Pattern `lengthBeats` uses local beats; Score note ticks remain score-local;
automation `curveDurationTicks` is independent master time. Arpeggiators use
their own rate with master-quarter clip lengths.

Instrument entries use discovered `patchId` with stable instance `id`, MIDI
`channel`, optional `values` and `mappings` keyed by controller node ID. Prefer
the existing instrument/routing commands when discovering a rack. Effects,
routes, mixer, Master and instance overrides remain performance-level data.

Limits remain the app's: 72 lanes, 512 definitions and 2048 clips per lane,
256 children per container, 65,536 leaves per content cycle, 10,000 notes per
Score pattern/50,000 authored Score notes, and at most 10 points per owned curve.
Long loops remain scalar windows. Explicit materialization checks capacity first.
