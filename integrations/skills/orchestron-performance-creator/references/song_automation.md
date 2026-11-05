# Instrument-bound automation

Run `edit automation list --instrument INSTANCE_ID` after adding the instrument.
Discovery returns eligible controller node IDs, ranges, effective values, CC
mappings and owned lanes. Continuous instruments do not have these MIDI mappings.
Use the stable rack instance ID, not a patch name or library ID.

`edit automation map --file PATH` takes
`{"instrumentId":"lead","mappings":{"NODE_ID":10}}`; null sets Off.
Mappings support CC 1–50. The operation reconciles affected lanes atomically.
Multiple nodes sharing one CC own one lane. Splitting mappings copies their
music; equivalent lanes merge. Different music requires an explicit `choices`
object whose `INSTANCE_ID:CC` key names the surviving lane. Inspect returned
conflicts before supplying that choice. Removed owners/Off mappings retain
authored curves and report suspension; suspended lanes emit no CCs.

Generate by matching an instrument clip:

```json
{"instrumentId":"lead","laneId":"melody","clipId":"chorus"}
```

Or specify a long independent window:

```json
{"instrumentId":"lead","id":"song-sweep","start":"0b","length":"512b"}
```

Run `edit automation generate --file PATH`. It creates one definition and Once
clip per owned CC, uses the controller's current mapped value and returns IDs.
Repeating the same window preserves existing music; overlapping different
windows fail. Step-mode lanes are not silently converted. No CC lanes are
created for an instrument with no eligible mappings.

`edit automation curve --file PATH` takes `laneId`, `definitionId`, optional
`duration`, `clipId` (fit duration to that window), and `points`:

```json
{"laneId":"RETURNED_LANE","definitionId":"RETURNED_DEFINITION",
 "duration":"512b","points":[{"position":0,"value":20},{"position":1,"value":110}]}
```

There must be 2–10 unique positions including 0 and 1; values are MIDI 0–127.
The CLI supplies stable point identities. Independent master-tick duration
allows one whole-song curve, with no repeated controller patterns. Both stored
steps and curve points survive controller-mode changes.

Run online `edit validate` before saving or pushing. `edit push-runtime` sends
mapping changes and the projected sequencers through the backend's coordinated,
revision-checked controller PATCH. This backend coordinates one changed owner
per request; stage/push owners separately, or rebuild an owned runtime for a
multi-owner remap. Stale revisions or failed preparation leave the previous
playing configuration intact. Fixed controller values remain per-instance
I-rate settings: new notes adopt them; continuous instances need a restart.
