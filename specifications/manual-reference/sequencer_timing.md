# Sequencer Timing — Technical Background

Technical material retained during the manual reorganization. Historical version numbers describe the source snapshot, not the current support matrix. Consult [AGENTS.md](../../AGENTS.md) and its linked source contracts when changing behavior.

Live edits use the usual coalesced preparation path without restarting transport. A preparation failure retains the playing configuration and the edited draft. Performances saved before format v17 and app state saved before v3 use the older quarter-note beat convention. Loading their /8 tracks doubles local beat lengths and halves subdivision, preserving step arrays, ratios, rests and valid undo history. For example, an old six-beat /8 pad becomes twelve eighth-note beats.
