# Data and playback contracts

[Index](README.md) · [UI design](ui-design.md) · [Implementation plan](implementation-plan.md)

These contracts separate chosen product behavior from proposed engineering defaults. Field names below describe responsibilities, not a final wire schema. Task 1 freezes the unresolved defaults; Task 2 implements a versioned model with frontend/backend agreement.

## 1. Model responsibilities

| Entity | Owns | Does not own |
| --- | --- | --- |
| Performance | Rack, bindings, routes, mixer/Master, tempo/song settings, lanes, reusable definitions and clip placements | Audition phase, held notes or transient selection |
| Lane/source | Stable identity, homogeneous source type, existing device routing and device-wide timing/settings | A different instrument for each pattern |
| Clip occurrence | Stable identity, lane, start, window duration, source offset, Once/Loop and ordered content references | Copies of every referenced musical definition |
| Pattern definition | Stable ID/revision/name, source type and existing typed musical payload | Instrument graph or temporary engine intent |
| Group definition | Ordered pattern/rest references and stable identity | Other groups or supergroups |
| Supergroup definition | Ordered group/pattern/rest references and stable identity | Other supergroups |
| Child occurrence | Stable identity and reference to a definition, or an explicit rest duration | Identity inferred solely from an array index |
| Editor draft | Base revision, selected occurrence path, pending changes, local undo/context | Authored data until scope-aware commit |
| Runtime layer | Prepared source, launch intent, source ownership, phase, generation IDs and audible status | Persisted song order |

The existing fixed pad index is not a sufficient definition identity. Local variations must not consume an occupied pad, overwrite the eighth pad, create a fake extra instrument or flatten references. Migrate each legacy pad to a stable pattern definition and retain unused pads/definitions. Keep resource limits explicit and bounded; the new model must support more definitions than an eight-slot editor adapter can address.

For the first release, definitions are compatible within their owning source lane. Cross-lane adoption copies/remaps compatible payloads explicitly; it does not create hidden dependencies between devices with different timing, drum-row identities or routing. Groups remain homogeneous. A future cross-lane pattern library is separate work.

Do not move current device-wide properties into patterns accidentally. For example, controller mode/CC/channel targets and source routing currently belong to the device, while both curve and step datasets live in each pad. The selected editor must distinguish **Pattern** changes (scope dialog) from **Lane settings** changes (explicit lane-wide effect). All existing fields must have an ownership mapping before adapters are written.

## 2. Exact time and clip windows

Store and calculate time exactly. Use a canonical rational musical-time representation or an equivalent existing exact subdivision representation; do not accumulate floating-point beats in a browser animation loop. The shared master timeline and each source's local meter, subdivision and rational playback speed remain distinct.

Convert local pattern duration through the existing timing resolver. Conceptually, local beats convert to quarter-note units by `local beats × 4 / meter denominator × speed denominator / speed numerator`; the global meter then determines the displayed bar/beat labels. Verify this mapping against current timing fixtures, including score-native ticks and arpeggiator master-beat durations. Preserve sparse score resolution of 20,160 ticks per quarter rather than rounding score notes to a step grid.

Let `S` be clip start, `W > 0` its window duration, `D > 0` resolved source duration and `O >= 0` its source offset, all in the same exact resolved time domain. At song position `T` inside the half-open window `[S, S + W)`:

- Once resolves source time `O + T - S` while it is below `D`; the remaining window is silent.
- Loop resolves `(O + T - S) mod D` with an explicit pass identity.
- Outside the window the clip emits no new events.

An empty draft has no playable duration; do not calculate modulo zero. It may remain editable, but cannot be launched or committed as a referenced empty group/supergroup. Explicit silence is a rest with a positive duration.

Changing a definition's duration recomputes content placement within its containers and the number of passes inside each clip. **It never moves clip starts/ends or following clips.** An offset beyond a shortened source yields silence in Once; Loop resolves modulo the new duration. Display that consequence before a scope-wide save. This intentionally differs from the current cumulative token arranger, where changing a shared duration can move later material.

Proposed editing semantics:

- Move changes `S`; right trim changes `W`; left trim changes `S`, `W` and `O` together. Keep exact source alignment. Left extension stops at source offset zero unless the user explicitly chooses another offset.
- Fit uses the remaining source duration from the selected offset and a single source pass. If no remaining source exists, offer Reset offset first. Never stretch content or ripple neighboring clips implicitly.
- Same-lane overlap is rejected with a clear collision preview. Explicit overwrite/insert/close-time operations have their own atomic transactions.
- Gaps and trailing rests remain first-class song timing. Deleting a clip leaves the covered time available; it does not close the song automatically.
- A clip cut/window crop is nondestructive even for a score crossing the cut. Existing range-edit restrictions may remain for operations that would structurally split indivisible source definitions; visual window cropping must not erase their notes.

The scheduler stops clip-owned attacks at the end and releases notes according to existing source ownership and source-specific ending rules. Do not cut effect tails or release other sources' notes on the same channel. Negative timing offsets, strums and ratchets cannot escape an isolated clip's allowed boundary; use current start/stop/seek rules for pending strikes. Characterize same-pattern continuation separately: a five-step arpeggiator rhythm must not reset every time its four-beat duration repeats if the existing continuous same-pattern behavior would preserve it.

## 3. Hierarchy, occurrences and repeat identity

Store references, not a permanently flattened event list. A derived traversal can expose resolved intervals, source paths, repeat-pass indices and revisions for scheduling/rendering. Bound traversal depth, child count, definition count and expanded work before allocating. Reject cycles, dangling references, incompatible types and invalid durations at load, save and runtime configuration boundaries.

Use an occurrence path such as `(lane ID, clip ID, child occurrence IDs, repeat pass)` to identify an edit. The same definition may appear twice in the same group; those are different occurrences. A renderer's array index or SVG element ID is not a durable edit address.

For a local edit to a generated repeat pass, materialize at most the necessary before/edited/after clip windows. Preserve total coverage, source offsets, other passes, routing and trailing silence. A partial first/last pass must remain partial. Keep descendants outside the edited path linked. If a duration change cannot be represented faithfully under these rules, reject the operation with an explanation; never approximate it by shifting song time.

Example: a 16-beat window loops an 8-beat supergroup containing Group A → Pattern P. Editing P in pass two locally keeps pass one linked to the original supergroup, creates a variation of P and the required group/supergroup ancestors for pass two, and leaves the full 16-beat window coverage unchanged. Reordering a group locally applies the same path-copying rule at group level.

## 4. Drafts and save transactions

Authoring state, editor drafts and runtime audition overlays are separate. A musical edit enters the draft associated with its base definition revision and occurrence path. It must not change every linked occurrence before the user chooses a save scope. The same draft backs the full editor and inline curve view.

During Play edit, prepared draft updates may be heard through a temporary runtime overlay. Without Play edit, editing a draft does not silently replace the arranged definition. Keep the existing preparation pipeline, coalescing and failure behavior; only the source of the pending payload changes.

On Save, validate the complete change and then atomically:

- **Only this occurrence:** create a variation of the changed definition; copy shared ancestors only along the selected path; reconnect that occurrence; preserve untouched child links. Isolate a selected generated repeat pass as described above.
- **All linked occurrences:** update the selected definition's payload/revision in place, retaining its identity. Resolve every direct/indirect use for impact reporting. Clip windows remain fixed even if content duration changes.
- Preserve the draft on cancel, validation/preparation error or revision conflict. Rebase/review conflicting changes explicitly; do not silently overwrite an independently updated definition.

Group/supergroup structural edits use the same transaction boundary. A newly created group is staged until saved, rather than immediately mutating the shared library as the old workspace can do. Committing a group does not implicitly commit unsaved musical edits in its children: include them in an explicitly described atomic change set or require separate resolution.

Use one arranger-history action for a scope commit, path-copy, repeat split, grouping, section edit or drag gesture. Preserve the existing 25-action/cursor history contract and persisted redo chain when valid. Per-pattern editor undo, especially score undo, remains distinct from authored arrangement undo. Unrelated runtime updates do not clear history. Incompatible imported history must be rejected/reset explicitly without damaging the performance.

Save Performance/autosave/native export read authored state only. Autosave does not resolve a draft's reuse scope automatically. Explicit save/export with pending drafts offers Resolve drafts, Use saved definitions, or Cancel. Draft retention across collapse/view switches is required; surviving reload is not implied by runtime audition. New/Load/Import resolves unsaved work and resets temporary context.

## 5. Proposed transport state contract

This section is an explicit proposed implementation baseline. Current production clears workspace auditions on Arranger Play/Stop; the chosen mockup separates editor audition from song transport. Task 1 must review and characterize that intentional change before Task 3 changes runtime commands.

Use one foreground editor audition in the initial redesign. Its target is a pattern, group or supergroup, independent of the visible selection. Selecting something else retains the draft and does not silently switch the sound. Pressing Play edit on another target prepares it before handing over the existing audition. Clearly display the target while it is sounding.

| Action/state | Song layer | Editor audition | Keyboard/manual input |
| --- | --- | --- | --- |
| Play edit, song stopped | Cursor stays fixed | Start instruments as needed, loop selected source at a render boundary | Existing enabled inputs continue |
| Play edit, song running | Other lanes continue; target lane's arranged output is temporarily suppressed | Prepare, then enter on the source-appropriate cycle/bar boundary | Continue |
| Stop edit | Resume target lane at current song position, or remain silent if song stopped | Cancel queued launch/updates and release audition-owned notes | Continue |
| Play song while audition active | Start from selected song range/cursor, retaining target-lane override | Continue its established phase | Continue |
| Stop song / finite song end | Stop arranged sources and retain documented cursor behavior | Continue as standalone audition until Stop edit | Continue |
| Seek / song loop wrap | Re-map arranged sources and chase supported held notes | Keep audition phase; stop returns to the new song position | No phase/reset changes from song seek |
| Save a playing draft | Authored data commits according to scope; schedule prepared changes safely | Retain audition and its phase until explicitly stopped | Continue |
| Global Stop all / engine stop / performance replacement | Stop all arrangement work | Cancel all pending commands and release owned notes | Release held notes and stop/reset as existing global controls require |

Source-specific quantization wins over a generic prototype “next beat.” Preserve score bar/end launch choices and arpeggiator cycle/bar choices. A stopped arpeggiator still needs actual input notes; in its legitimate Live clock mode the first note establishes the pulse. Its Arranger/Live clock setting, hold, restart and processing behavior must not be conflated with the removed Arrangement/Manual pads UI.

For a newly authored clip, that arpeggiator clock choice governs phrase timing while the clip window or explicit audition is active; it does not authorize output outside the window. A legacy independently running Live arpeggiator must remain in compatibility handling until conversion has explicitly accounted for that difference. Do not silently turn a free-running legacy source into a window-gated one.

Retain existing momentary speaker previews where they remain useful. Priority is momentary preview → editor audition → arranged source; release restores the lower layer at its current phase, not a saved stale cursor. Preserve the 250 ms hold gesture and stale-command protection. Do not reintroduce a separate pattern workspace merely to reuse its runtime command names.

Collapsing a lane retains explicit editor audition and exposes its active state in the compact header. It ends any momentary pointer preview/held input. Leaving the performance view or closing the editor ends its audition safely while retaining the draft; ordinary track selection does not. These distinctions require tests because old workspace collapse/navigation semantics differ.

Temporary lane mute/solo remains a source gate over both arranged and audition output, with existing dependency-aware arpeggiator behavior. It does not stop clocks, mutate mixer state or enter saved/exported configuration. Arpeggiator input from other lanes/live sources must still reach the correct source when its own lane is auditioned. If a stopped-song audition lacks an input chord, show that state rather than secretly starting unrelated musical lanes.

## 6. Runtime, engine and controller invariants

Keep browser-clock rendering, PCM worker refills, SharedArrayBuffer/AudioWorklet playback and engine-local timestamped MIDI. React observes audible status; timeline previews and requestAnimationFrame never drive sound. Preparation remains in the persistent compiler process. Rapid edits coalesce with the existing 80 ms policy and apply at the appropriate prepared block/launch boundary without resetting transport.

Use generation/command identity checks for asynchronous starts, stops, selections, save commits and preparation results. A late preparation result cannot restart a stopped audition, apply to a removed clip or overwrite a newer draft. Failed preparation keeps the previous sound and edited draft, reports the error, and waits for another edit or explicit retry. Do not repeatedly submit full configurations on status/playhead changes.

Automatic engine startup is idempotent. Track active reasons: arranged sources, editor/preview sources, started keyboard/controllers and explicitly started engine. Stopping one reason must not stop instruments still needed by another. Preserve explicit instrument-engine controls and topology locks; starting a new source may use an already assigned instrument while running, but cannot bypass locked rack changes.

Reuse [BrowserPlaybackPolicy](../../frontend/src/audio/browserPlaybackPolicy.ts) and the [documented latency behavior](../../documentation/configuration/browser_clock_latency.md). In Auto, manual Start/input activity selects Live; held notes, sustain and gestures maintain it; inactivity returns to Listening. Merely leaving a keyboard/controller enabled does not keep Live forever. Explicit Live/Listening settings override Auto. Sequencer output and automatic controller initialization do not count as human input. Changing mode preserves queued audio and transport. No new hard-coded buffer values are introduced by this redesign.

Controller automation preserves existing semantics: curve sampling only sends changed values; Step Mode distinguishes null from zero, retains repeated populated cells, initializes/reset values at the documented start/stop/seek transitions, and holds values through ordinary rests/loops. Preview entry/exit and clip transitions must map to those rules explicitly. Do not reset all CCs globally or accidentally reset at each ordinary loop pass. Routing changes retain the existing entering/departing CC/channel rules; shared destinations remain last-message-wins.

## 7. Migration and compatibility

The inspected frontend writes performance config **v22** and app state **v4**. Native bundle envelope version is a separate concern. Allocate the next appropriate versions at implementation time after checking current source; do not silently add incompatible clip semantics to v22 or rely on outdated manual version labels.

Migration is deterministic, bounded and idempotent. Preserve the original native performance/export or equivalent complete recoverable payload before conversion. Produce a report of converted sources and any cases requiring explicit decisions.

| Legacy data | Required treatment |
| --- | --- |
| Eight pads, unused pads, groups/supergroups and colors | Stable definitions with identical typed payloads and shared-reference relationships; retain unused material and display metadata. |
| Root sequence, rests and per-lane repeat/end behavior | Exact clip placements/content whose scheduler output matches the legacy song. Do not force every lane into a single once-only clip. |
| Hidden steps/notes, both controller datasets, arp presets/seeds | Preserve all authored values, including data outside the current pattern length. |
| Manual pads running independently or Live arp behavior | Preserve through a tested adapter/compatibility view until an explicit conversion into clip context and source-clock settings is available. Never silently make it an arranged source. |
| Multiple piano keyboards | Keep all configurations accessible through compatibility handling. New performances have one fixed keyboard; existing extra keyboards cannot be silently deleted or merged into one channel. Consolidation requires an explicit user choice and recoverable original. |
| Manual controllers | Preserve count, names, enabled settings, CC/channel selections, values and export initialization. |
| Routing, mixer, Master, assets, instance settings, continuous instruments | Unchanged, including unassigned/unused data required by native whole-rack persistence. |
| Arranger history | Migrate supported actions and cursor exactly, or explicitly reset incompatible history; never reinterpret old indices as new IDs. |

Unsupported legacy cases remain usable in the existing compatibility path with a clear reason. That path is a migration safeguard, not the desired new standalone-sequencer workflow. Do not make the redesign the only editor until the compatibility matrix passes. Older clients must not unknowingly overwrite new-format content; validate capabilities/version at API boundaries.

## 8. Serialization and export parity

Native save/load, autosave, JSON/ZIP bundles and CLI authoring use the same versioned authored model. Validate new definitions and histories against persisted-size limits. Runtime positions, audition overlays, draft scopes, mute/solo and held notes never leak into saved configuration.

Both CSD modes and MIDI event generation resolve the same clip windows, offsets, nested references, repeats, gaps, source timing and endings as online playback. Preserve score note chasing, arpeggiator chord-input dependence and seeded variation, drum ratchets/timing, controller interpolation/steps/reset semantics, enabled manual-controller initialization, instrument selection, Master routing and release tails.

Do not export a flattened approximation that loses sharing in the native format, and do not use a live audition's current sound as the exported authored score. An online/offline parity fixture must compare event timing and ownership at boundaries, not only whether exported text parses.
