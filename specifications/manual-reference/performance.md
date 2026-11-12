# Performance — Technical Background

Technical material retained during the manual reorganization. Historical version numbers describe the source snapshot, not the current support matrix. Consult [AGENTS.md](../../AGENTS.md) and its linked source contracts when changing behavior.

- Save or Enter applies the name. Cancel or Escape discards the draft. Clicking elsewhere does not save; switching performances or removing the device discards the draft.
- Names must be nonempty after trimming surrounding whitespace and contain at most 65 Unicode characters. HTML and angle brackets (`<` and `>`) are rejected.
- Names must be unique across all six device types within the performance, ignoring case and surrounding whitespace. Validation messages appear while typing, and Save is disabled until the name is valid.
- Names retain their capitalization. Melodic synchronization choices and arranger track titles show the stored names. New devices receive an unused numbered default name.
- Renaming preserves device IDs, synchronization, routing, patterns, and playback state. Names survive performance save/load, browser persistence, raw snapshot import, and native JSON/ZIP export/import.
- Existing/imported names remain intact under the existing loading rules, even if they violate the new editing rules. They display as plain text and need a valid replacement only when renamed. API acceptance is unchanged.

Collapsed visual bodies are suspended: hidden grids and timelines are not built, animation loops stop, and hidden meters unsubscribe. This includes the Mixer and each nested routing, matrix, diagram, channel-mapping, diagnostic and insert section. Playback, pad switching, MIDI processing, audio controls and meter collection continue. Visible headers, rack summary, shared tempo and footer transport status keep updating. Expanding displays the current playback position and latest meters immediately, without replaying missed animation frames.
