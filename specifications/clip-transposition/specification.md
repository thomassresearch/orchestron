# Clip transposition specification

Status: implemented in the clip-arranger preview; see [implementation and verification record](implementation-record.md). Date: 2026-11-04.

Requirement provenance and scope are recorded in the [package overview](README.md). The [implementation plan](implementation-plan.md) and [acceptance scenarios](acceptance.md) are part of this contract.

## 1. Scope and invariants

Support melodic sequencer, score sequencer and arpeggiator patterns, including groups and supergroups in their lanes. Disable transposition on rests, drummer lanes, generic controller lanes and instrument automation lanes. Preserve existing arpeggiator built-in transpose and scale-quantization behavior before applying this new layer.

Transposition changes pitch only. It must not change authored notes/chords, durations, velocities, holds, strum timing, ratchets, probabilities, seeds, routing, instrument assignments, source timing or clip geometry. Authored scale/root/mode metadata also remains unchanged; chromatic transposition is not a key-signature edit.

The current bounded hierarchy remains: clip children may reference patterns/groups/supergroups; groups contain patterns/rests; supergroups contain groups/patterns/rests. There are no cycles or cross-lane definition references. Repeat continues to repeat the clip's entire child sequence. This feature does not introduce nested independent repeat counts, pitch automation curves, microtonal tuning, destructive Apply to notes, or transposition of arbitrary keyboard/MIDI input outside an arranged source.

## 2. Ownership and sharing

### 2.1 Three independent layers

| Layer | Stored on | Shared by | Purpose |
| --- | --- | --- | --- |
| Definition profile | Lane profile table, referenced by the definition | Every linked use of that definition, including other clips | Common base and per-repetition transpositions |
| Child-reference plan | A non-rest `ContentItem` | Uses of the parent definition that owns that child; clip-root children belong only to their clip | Independent offset for this pattern/group inside its parent |
| Placement plan | A clip record keyed by the full child-occurrence path | Only that placement in that clip | Local all-pass or single-pass adjustments without forking notes or splitting a loop |

All three layers are additive. A placement plan does not mask future changes to a shared definition profile or a child-reference plan. The inspector must distinguish the individual contributions from the combined result.

Each reusable definition has at most one canonical profile reference. Missing references mean identity transposition. Creating the first shared setting attaches one profile to the definition, so already-existing and subsequently adopted linked clips automatically use it. Do not create one profile per clip and synchronize copies afterward.

Profiles are separate from musical payloads and can have their own revision. They may be referenced by more than one definition after automatic ancestor forks. Distinct profiles with equal values are not merged automatically: value equality does not imply shared ownership.

### 2.2 Required example

Pattern P has shared diatonic repetition values `[0, +2, +4, -1]`. Clips A and B both repeat P. Editing repetition 3 through A changes P's shared entry at index 2; B's repetition 3 changes too, even when B starts elsewhere, is cropped, or currently hides that repetition.

An additional chromatic +12 on A's placement leaves the shared values identical, but A sounds an octave above B. The inspector explains the difference as a local contribution, not a broken link.

### 2.3 Nested independence

For `S -> G -> P`, shared profiles and contextual offsets may exist at all three levels. Setting P's child-reference plan inside G affects every use of that child in G, but not standalone P or P inside another group. Setting G's reference inside S affects that position in S, but not standalone G. A placement plan can address only one of those uses through its full path.

If G contains P twice, the two child IDs distinguish the references. Both inherit P's shared profile; each can add a different reference or placement plan. Never key contextual edits solely by pattern ID, array position, display name or MIDI channel.

Two clips that share only P do not thereby share their unrelated top-level structures. To share a collective progression over several children, reuse a group/supergroup and edit its profile.

## 3. Offset plans and repetition identity

### 3.1 Plan evaluation

A pitch offset is a pair `(diatonicSteps, chromaticSemitones)`. A plan contains one default pair and sparse indexed replacements. For logical repetition index `n`:

```text
evaluate(plan, n) = plan.repetitions[n] if explicitly present
                    otherwise plan.base
```

An indexed entry replaces the base of that one plan; it is not added to its own base. Results of different plans are added. Missing plans are identity `(0, 0)`. Explicit zero is meaningful when the base is nonzero. Removing an entry restores the base rather than installing zero.

User-facing repetition numbers start at 1; persisted indices start at 0. Unspecified later repetitions use the base. No implicit wraparound, hold-last-value or cumulative transposition occurs. A plan with entries for repetitions 1–4 does not automatically restart at repetition 5.

Shortening a clip retains hidden entries. Extending it reveals the existing shared entries. Changing a default retains explicit entries, even entries now equal to the default: their future behavior differs if the default changes again. Cleanup of redundant entries must be explicit.

### 3.2 Source-relative indices

Let `D` be the duration of the entire clip content, `t` the current position in the clip's lane-cycle coordinate system, and `raw = clip.offset + t - clip.start`.

```text
physicalPass = floor(raw / D) in Loop mode, otherwise 0
logicalPass  = clip.repeatIndexBase + physicalPass
```

`repeatIndexBase` defaults to zero. A Once clip is silent when `raw >= D`; its active content still uses `repeatIndexBase`. A newly created Once clip therefore uses entry 0. This makes Once and the first Loop pass sound the same.

All descendants in one clip content pass use the same logical index. Two P references in that pass both read P's entry for that index; they are not successive accesses to a global P counter. Their independent contextual plans distinguish them. Repeating a group twice by explicitly placing it twice is also two references, not an additional independent loop dimension.

Moving a clip does not change these indices. A left trim advances the source offset and may expose a later repetition; it never restarts numbering at the new visible edge. A seek derives the index directly from source position. Song loops and legacy lane cycles revisit the same authored indices, irrespective of elapsed playback time.

### 3.3 Split and duration rules

Existing musical/structural edits may isolate a generated pass as a Once clip. If its original logical index was `n`, the isolated clip gets `repeatIndexBase = n` and an offset within that content pass. Before/after windows preserve the original mapping, including partial passes. Do not reset a selected transposed pass to profile entry 0.

Transposition-only edits never require a split, materializing repetitions, copying note payloads or changing clip length. Clip-local placement plans express the exceptions compactly.

Duration edits retain indexed settings by logical number, never by wall-clock timestamp. Existing structural phase/span scaling must preserve logical-pass alignment; the base participates in the mapping. Existing musical saves retain their fixed-window/source-offset contract: changing content duration may change which logical passes a crop exposes. Show this in the impact preview; do not silently renumber the plan to compensate. Tempo changes alone do not change source indices.

## 4. Musical transformation

### 4.1 Canonical composition

At a leaf pattern, evaluate the applicable definition, child-reference and placement plans along the selected path. Sum their diatonic components into `d` and chromatic components into `c`.

```text
playedPitch = diatonic(originalPitch, leaf.scaleRoot, leaf.mode, d) + c
```

Do not alternate chromatic and diatonic operations as the tree is traversed. Do not approximate scale steps as semitones. This canonical rule makes regrouping with an identity parent neutral and lets independent offsets combine predictably. There is no intermediate MIDI-range clamp.

For C-major notes C4–E4–G4, P +1 diatonic, G +12 chromatic and S +1 diatonic produce E5–G5–B5. Another pattern under G uses its own configured scale/mode for the same inherited degree total. Containers do not impose a separate scale.

### 4.2 Exact diatonic algorithm

Use the existing supported root and seven-note mode interval tables. Given integer MIDI pitch `p`, root pitch class `r`, sorted mode intervals `s[0..6]` starting at zero and signed integer degree count `d`:

```text
q  = floor((p - r) / 12)
pc = p - r - 12*q
i  = largest index with s[i] <= pc
a  = pc - s[i]
k  = 7*q + i + d
q2 = floor(k / 7)
j  = k - 7*q2
diatonic(p, r, s, d) = r + 12*q2 + s[j] + a
```

The accidental `a` is measured once from the original pitch, relative to the lower scale tone. Degree totals are applied in one operation, not by repeatedly calling the existing one-step UI helper. Use mathematical floor/modulo for negative values consistently in TypeScript and Python.

Zero degrees is exact identity for every pitch, including off-scale notes. Seven degrees is one octave for every supported mode. Off-scale spelling cannot be recovered from MIDI pitch alone; the lower-tone rule is the canonical interpretation. The transformation is not guaranteed to be invertible after materializing intermediate pitches, and distinct original notes can converge to one output pitch.

The original pattern's theory stays unchanged in downstream source metadata. An arpeggiator that follows source theory may therefore quantize chromatically shifted incoming notes according to that unchanged theory, as its current source-following behavior dictates.

### 4.3 Range, chords and collisions

Apply the chromatic total after the diatonic result, then omit pitches outside 0–127. Do not clamp, octave-wrap or reject an entire otherwise valid pattern. Omission must not create a voice or a later note-off. Static previews/inspection report the affected notes; dynamic arpeggiators may report omitted output from actual input without predicting unknown chords.

Expand melodic chord symbols using the original pattern settings, then transform every generated tone. Do not transpose only the chord root and reconstruct the old chord type. Score notes transform individually, including hidden notes when they become playable; their authored values remain untouched.

Preserve original strum attack order, per-tone delays and releases. Transform prepared attack pitches rather than re-spacing the remaining tones after omissions or collisions. Simultaneous equal output pitches collapse using the existing deterministic source ordering; later same-pitch attacks use existing retrigger/release ownership. Score preparation rebuilds pitch indexes and overlap handling after transformation, with the current stable `(start, note ID)` ordering.

## 5. Proposed authored format

These names are the implementation starting point; equivalent representations must preserve the contracts and fixtures.

```ts
type PitchOffset = { diatonicSteps: number; chromaticSemitones: number };
type OffsetPlan = {
  base: PitchOffset;
  repetitions: { index: number; offset: PitchOffset }[];
};
type TransposeProfile = {
  id: string;
  revision: number;
  plan: OffsetPlan;
};

// Add to ClipLane:
transposeProfiles?: TransposeProfile[];

// Add to DefinitionIdentity (pattern, group and supergroup):
transposeProfileId?: string;

// Add only to a non-rest ContentItem:
transpose?: OffsetPlan;

// Add to Clip:
repeatIndexBase?: number; // absent means 0
transposePlacements?: { path: string[]; plan: OffsetPlan }[];
```

This is a field sketch, not a complete replacement for existing types. An absent plan/profile is identity; creating the first setting upgrades the document format. Musical payloads keep their existing structure. Profiles and plan entries are authored data; prepared maps, variants, sounding-pitch ownership and pending live changes are session-only.

Validate integers strictly, including rejection of booleans on Python inputs. Reject unknown modes/fields, duplicate identities, duplicate or unsorted repetition entries, missing/cross-lane profile references, invalid paths, plans on rests/unsupported lane types and out-of-bound totals before expensive preparation. Every placement path must resolve to exactly one non-rest occurrence in that clip's authored tree. Validate unused definitions and profiles too.

Profiles use stable IDs and bounded monotonic revisions like definitions. Shared profile edits increment profile and arrangement revisions; child-reference edits also increment the owning container revision. Placement edits increment the arrangement revision. Drafts fingerprint every dependency they edit or use for an impact preview; concurrent updates must not overwrite each other.

### 5.1 Proposed resource budgets

Existing clip, note, JSON and export limits continue to apply. Define additional named constants in frontend/backend/CLI contracts and verify boundary parity. Initial budgets for implementation measurements are:

| Resource | Proposed limit |
| --- | --- |
| Authored component in a base/entry | Integer −127 through +127, independently for both modes |
| Profiles | 1,024 per lane, including unused profiles |
| Indexed replacements | 4,096 per plan; 65,536 total authored entries per performance |
| Clip placement paths | 1,024 per clip; 65,536 total per performance |
| Logical repetition index | 0 through `2 * MAX_CLIP_TICKS`; also validate derived clip index extents |
| Materialized effective-plan indexed replacements | 65,536 per lane after deduplication, counted before allocation |
| Additional nonidentity prepared pad variants | 256 per lane; 1,024 per performance |
| Additional transformed score-note records | 200,000 per prepared performance |

There are at most three definition levels and three contributing plans per level. Effective sums may exceed the individual authored range and must remain exact; validate the final MIDI result, not intermediate sums. If a structural operation would exceed an authored/derived budget, reject it atomically with the affected item and limit. Do not truncate offsets, repetitions or notes to make the edit fit.

These are proposed safety budgets, not measured capacity claims. Task T1 must measure memory/preparation costs and record any adjusted values before rollout. Existing identity-only performances must not acquire a lower capacity merely because this feature is installed. Cache retention needs a measured memory budget in addition to entry counts, since score sizes differ greatly.

## 6. Editing and structural operations

### 6.1 Editing scopes

The inspector separates three clearly named targets instead of sending all changes through the current generic local/all musical-save flow:

| Target | Effect |
| --- | --- |
| Shared transposition | Edit the selected definition's profile, including the current logical repetition; all linked clips update |
| Offset in parent | Edit the selected child reference; show which linked uses of its parent are affected |
| Offset in this placement | Edit this clip's full-path placement plan; choose the base or current logical repetition |

Selecting a generated repeat and choosing Shared transposition initially targets that repetition's entry, not the profile base. This is the default workflow for the user's shared-repeat requirement. Base editing is a separate explicit selection. A local adjustment is not automatically chosen by the legacy Save dialog's local default.

Each edit action chooses Diatonic or Chromatic and a signed amount. Internally both components can coexist, including after grouping/ungrouping. Switching the displayed mode selects a component to edit; it does not convert units or erase the other component. Display both nonzero components and offer Reset selected component, Clear repetition entry (inherit base) and Reset plan. Distinguish “set this repetition to zero” from “inherit”.

Changes stay in a session-only draft until Save. Show affected linked clips/parents, current repetition and old/new effective values before committing. Save is one validated transaction and one arranger-history entry. Cancel/Discard leaves authored state unchanged. Existing musical/structural draft resolution must include transpose drafts; do not introduce a second inconsistent Save/Discard/Cancel flow.

Performance save/export uses committed authored settings and retains existing unresolved-draft prompts. Merely selecting a repeat, expanding a lane, changing zoom or receiving playback status does not prepare audio or change revision counters.

### 6.2 Identity-preserving operations

| Operation | Required behavior |
| --- | --- |
| Adopt linked / copy a clip | Retain definition/profile links; copied clips receive independent placement-plan records and equivalent source alignment |
| Explicit musical variation | Fork the chosen definition and its own profile by value; retained descendant definitions keep their links |
| Automatic ancestor copy-on-write | Preserve ancestor profile references and child plans unless the operation explicitly edits them |
| Local transpose edit | Write a placement plan; no musical definition fork or clip split |
| Reorder siblings | Preserve child identity, plans and placement targets; no global repeat counter changes |
| Move into another parent | Retain the moved item's own plans; inherit the destination ancestors, with old/new effective offsets visible; no hidden compensation |
| Group with a new container | New parent is identity; preserve the effective sound and all existing child/profile links; remap placement paths |
| Ungroup | Snapshot the removed level's contributions into lifted child contextual/local plans, preserving every default and indexed value |
| Delete occurrence/clip | Remove its dependent placement paths; retain reusable definitions/profiles and unrelated overrides |
| Split/trim/range copy/paste | Preserve logical indices and surviving full-path plans, including hidden repeat entries and partial windows |
| Undo/Redo | Restore profile identities, values, links, paths and repeat bases atomically with the existing 25-action history |

Ungroup is a scope-aware algebra operation over plans, not just lifting children. Merge sparse index unions and defaults without enumerating clip time. Shared removed-level contributions become contextual snapshots; clip-specific removed-level contributions remain clip-specific. Child and surviving ancestor profile links stay live. Later edits to the removed group's profile no longer affect the ungrouped placement, because it no longer references that group. Reject an over-budget result before mutating state.

All paths affected by fresh child IDs, ancestor forks, grouping, ungrouping, collision-avoidance ID changes or split windows need an explicit remapping result. Apply it to saved placement plans, open drafts, selections and undo/redo metadata together. Never silently discard an unmatched plan; treat it as a transaction conflict unless its occurrence was deliberately deleted.

## 7. Runtime projection, preparation and playback

### 7.1 Runtime schedule v2

Keep bounded source spans and lazy Loop lookup. Extend the existing schedule with:

- An interned, immutable bank of validated offset plans.
- A short list of applicable plan references on each non-rest leaf span, obtained by walking the occurrence path.
- The clip's repeat-index base.
- A prepared position result that exposes logical repetition and the effective transform identity, in addition to source phase, pad and next boundary.

TypeScript and the standalone Python CLI must produce equivalent schedules from the same authored fixture. Backend schedule validation must independently reject malformed banks/references/bounds. V1 schedules remain identity-only inputs. Do not rely on client validation for runtime cost limits.

Do not expand all passes or all combinations of independent plans. For a leaf's plan-reference set, compose its default and the finite union of its explicitly indexed replacements, intern identical pairs and enforce aggregate bounds before allocating prepared objects. An indexed replacement applies only at its exact index: lookup falls back to the composed default at every other index, not to the previous replacement. This is not a hold-last-value breakpoint curve. The same original pattern and effective pair can share a prepared variant across clips.

### 7.2 Prepared melodic and score variants

Prepare outside the render/refill thread in the existing preparation service. Cache immutable variants by complete musical content/timing fingerprint, configured root/mode, effective offset and transform algorithm version. IDs/revisions alone are insufficient cache keys for imported documents. Reuse unchanged base data; never alter the original payload or allocate extra authored pad slots.

Use a separate variant table indexed by base pad and transform identity. Rebuild score attack/pitch/ID indexes with transformed pitches and existing note ownership. Transform melodic note arrays and strum attack pitches while retaining timing. Both Python and Cython kernels resolve the same effective variant. Identity settings reuse the current fast path where possible.

Every variant needed by an accepted configuration must already be ready before that configuration can play. An LRU cache may accelerate later preparations but cannot evict live dependencies or trigger a render-thread cache miss. Reject preparation over budget and keep the previous playing configuration and edited draft.

### 7.3 Arpeggiators

Build a 128-entry map per configured scale/mode and effective pair, with a sentinel for omitted pitches. Apply it after existing pool selection, built-in transpose and existing scale quantization, using the pattern's configured root/mode for this new diatonic layer. Existing `scale_mode: source` still governs the earlier quantizer; it does not silently change the new layer's scale. Show that distinction in help.

Track transform/occurrence changes even when the pad index is unchanged. Existing arpeggiator clip lookup mainly observes pad/phase changes and must not miss a new transposition on the next repeat. Preserve held input ownership, rhythm position, seeds and ordering. Do not transform both the held input pool and its generated output for this one layer. An upstream melodic source and a downstream arpeggiator may each intentionally apply their own separate arranged transform.

Bypass remains true bypass: this new arpeggiator processing layer is inactive in bypass mode. Muted/stopped behavior remains unchanged. Output previews use the same map as emitted notes and handle omitted/merged pitches without fake notes.

### 7.4 Voice ownership, timing and live changes

Own releases by actual emitted pitch and original source/occurrence identity. Handle transformed collisions with the existing same-pitch retrigger rules; original pitch alone is not a release key. Seek/chase and range-start export must select the destination transform before building/chasing voices. Omitted notes have no active voice. Ordinary clip boundaries retain existing release/crop behavior.

Transposition-only saves use normal asynchronous preparation and configuration revision checks, then install at an engine block boundary without resetting transport. For each already-running leaf occurrence, pin the previous effective pair until the next leaf occurrence boundary. Later requests replace the pending pair. Group/supergroup changes therefore take effect at each lane's next leaf boundary, not only after the whole container ends. Pending state is runtime-only.

Pinned transforms apply to the attack's owning occurrence, including negative timing offsets, strums and ratchets that are scheduled ahead or cross a nominal boundary. Resolve a future attack from its target occurrence, not merely the currently displayed pad. Activation is occurrence-based: an early attack of the next occurrence may sound before its nominal boundary using that occurrence's pair. Once any attack of an upcoming occurrence has been committed to the scheduler, pin that occurrence's pair as well; a later edit waits for the next uncommitted occurrence. Never change the transform between an early attack and the remaining attacks of the same occurrence. The pending indicator must identify the actual target occurrence. Preserve existing source cancellation and release ordering.

A seek, restart, newly entered occurrence or fresh audition uses the latest committed/prepared pair immediately. Stop cancels pending runtime application. Mixed musical/transposition edits retain current musical live-edit semantics while keeping the active occurrence's transform pinned; preparation must include any transient pinned variant needed for those edits. Do not freeze unrelated musical edits or silently switch held voices to a new pitch.

## 8. Audition, presentation and exports

### 8.1 Audition

Extend clip-aware audition requests to carry a bounded occurrence schedule and transform context. The current plain pad/rest token sequence cannot express these settings. Preserve legacy audition payloads for old callers; new payloads must also be validated for duration, references and capacity.

Play edit of a selected pattern/group/supergroup auditions its effective placement, including all enclosing contributions and the selected logical repetition. Like the existing definition-editor audition, it starts at the selected definition's own content start and plays its complete active duration, not only the portion visible through the clip crop. Repeating that audition holds the selected logical index so the user can inspect that occurrence. Clip crops/source offsets continue to govern arranged playback; to hear the cropped result or full repeat progression, use arranger/clip playback. Label the audition as the selected definition/repetition so its full-duration behavior is clear. Exact child rests and timing must not be approximated through legacy rest tokens.

Audition captures the transpose draft being previewed; subsequent structural/transpose draft edits require an explicit audition refresh/restart. Ordinary musical editor live behavior remains intact. Save ends the draft audition through the existing lifecycle. Stop edit restores authored playback at current song position, including the correct transform, without leaking draft values into exports or autosave. Song Play/Stop/seek and temporary audition ownership retain the current clip contracts.

### 8.2 Inspector and timeline

Use the existing selected-occurrence breadcrumb and contextual inspector. Display:

- Selected scope and sharing, including linked-use counts and affected clip names.
- Current logical repetition, with hidden/partially visible repetition indication.
- Diatonic/chromatic controls, per-repetition values and explicit inheritance/zero state.
- A contribution breakdown for pattern, group and supergroup, and the effective pair.
- A pending-live-change indicator until the next relevant leaf boundary.

Expanded timeline items show compact `D +2` / `C +12` badges with accessible full labels. Selecting a generated repeat targets that repeat without splitting it. Melodic/score Note maps show sounding pitches for the visible occurrence; the musical editor continues to show authored notes with a clear playback-transpose indicator. Arpeggiator timeline previews remain parameter summaries, not invented note contours.

Provide keyboard access, signed numeric entry, localized units/help and focus restoration. EN/DE/FR/ES labels must distinguish scale steps from semitones. Suspend preview work for collapsed/offscreen content and resolve only visible repetitions. Do not resubmit configurations because a badge, meter or playhead updated.

### 8.3 Export consistency

Native bundles preserve musical payloads, profile sharing, contextual/placement plans, hidden entries, repeat bases and optional history. MIDI CSD and SCORE CSD use the same prepared scheduling/transform rules as live playback, including crop/seek chasing, omissions, collisions and arpeggiator output.

Standalone CLI normalization, runtime projection and export must preserve all new metadata. Existing legacy pad mutation commands continue to reject clip performances; this delivery does not require a new CLI transpose-authoring command. Export estimates include transformed/colliding/omitted event behavior conservatively within existing resource ceilings. No Csound instrument graph/opcode changes are required by the feature.

## 9. Versions, compatibility and rollout

Propose performance v25, app-state v7, clip model v3 and runtime clip schedule v2. Confirm allocation against current source before coding. New readers accept all currently supported older versions and interpret absent transposition fields as identity. Native bundle envelope versions remain separate.

Clip model v3 is a superset of v1/v2 and must retain instrument-bound automation. Replace brittle exact-v2 feature checks with explicit supported-version/capability validation where appropriate; do not make automation disappear in v3. Both transposition-only and automation-plus-transposition documents use the new envelope versions.

Do not upgrade untouched old performances merely on load. The first authored transpose/profile/base-index change upgrades atomically. Once upgraded, retain the version even if offsets return to zero, because hidden profiles/history may still require it. Existing-format writers remain for documents that never need the extension. Unknown newer versions fail explicitly; older clients must not be allowed to silently write away transpose metadata. Compatible native readers always honor saved new-format content regardless of the UI creation flag.

Do not enable authoring until API, runtime, CLI and exports all accept the format. The broader clip arranger rollout remains independently gated. A UI rollback does not downgrade persisted music; recovery uses supported readers/original backups. No automatic production-database conversion or example migration is authorized by this plan.

## 10. Baseline source seams

| Area | Inspected source |
| --- | --- |
| Definitions, paths and lazy frontend resolution | [model.ts](../../frontend/src/lib/clipArranger/model.ts) |
| Musical saves and pass splitting | [operations.ts](../../frontend/src/lib/clipArranger/operations.ts) |
| Structural expansion/materialization | [structure.ts](../../frontend/src/lib/clipArranger/structure.ts) |
| Runtime projection and existing token audition | [runtime.ts](../../frontend/src/lib/clipArranger/runtime.ts) |
| Authored validation | [clip_validation.py](../../backend/app/models/clip_validation.py) |
| Runtime schedule and positions | [clip_arrangement.py](../../backend/app/models/clip_arrangement.py), [clip_playback.py](../../backend/app/services/clip_playback.py) |
| Cached musical preparation | [sequencer_runtime_config.py](../../backend/app/services/sequencer_runtime_config.py), [score_sequencer.py](../../backend/app/services/score_sequencer.py) |
| Playback and voice management | [_sequencer_playback.py](../../backend/app/services/_sequencer_playback.py), [sequencer_strum.py](../../backend/app/services/sequencer_strum.py), [arpeggiator_runtime.py](../../backend/app/services/arpeggiator_runtime.py) |
| Existing destructive scale helper | [sequencer.ts](../../frontend/src/lib/sequencer.ts) |
| CLI projection | [clip_arrangement.py](../../integrations/skills/orchestron-performance-creator/src/orchestron/clip_arrangement.py) |

The source list identifies integration points; it is not evidence that those paths already implement these contracts.
