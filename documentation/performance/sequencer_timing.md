# Sequencer timing

[Performance](performance.md)

## Meter, pattern length and subdivision

For a one-bar triplet bass alongside ordinary drums, choose **Meter 4/4**, **Pattern length 1 bar · 4 beats**, and **Subdivision Eighth-note triplets · 3 per beat**. The bass shows **12 steps in four labeled beat groups**. Leave Playback speed at 1×. At 120 BPM both one-bar patterns last two seconds.

Pattern length applies to the selected pad: any integer from 1–16 local beats for melodic/drum pads, or 1–32 for controller pads. Whole bars show both bars and beats; partial bars show beats. Meter, subdivision and playback speed apply to all pads of that sequencer. Subdivision offers 1, 2, 3, 4, 6 or 8 steps per meter beat. Musical names follow the denominator: three steps per beat means eighth-note triplets in /4 and sixteenth-note triplets in /8.

Global BPM counts quarter notes. A local beat is a quarter note in /4 and an eighth note in /8: one bar of 6/8 lasts three song beats (1.5 seconds at 120 BPM). Changing the meter numerator changes grouping without resizing pads. Changing the denominator retains the beat count and steps, but changes elapsed duration. Compound-meter accent grouping is not applied.

Changing subdivision keeps numbered step positions, notes, holds, velocities and timing offsets. It changes the number of visible steps within the same pattern duration; it does not redistribute the music. Hidden steps remain stored and return when you expand the pattern. Controller keypoints keep their normalized positions. Each pad has a 128-step limit; choices that would exceed it on any affected pad are disabled with an explanation.

**Advanced timing → Playback speed** contains the existing ratios, with multipliers: 1:1 = 1×, 3:2 = 1.5×, 2:1 = 2×. A speed other than 1× stays visible when Advanced timing is closed. The summary shows step count, subdivision and elapsed quarter-note song beats, separate from the pad's local length. Bar boundaries are stronger than beat boundaries, including incomplete final bars; no silent cells are added. Controller guides use bar.beat labels.

Live edits use the usual coalesced preparation path without restarting transport. A preparation failure retains the playing configuration and the edited draft. Performances saved before format v17 and app state saved before v3 use the older quarter-note beat convention. Loading their /8 tracks doubles local beat lengths and halves subdivision, preserving step arrays, ratios, rests and valid undo history. For example, an old six-beat /8 pad becomes twelve eighth-note beats.
