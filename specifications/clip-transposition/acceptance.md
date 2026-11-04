# Clip transposition acceptance scenarios

Status: implemented in the clip-arranger preview; see [implementation and verification record](implementation-record.md). Date: 2026-11-04.

Behavior is defined by the [specification](specification.md). Work and gates are in the [implementation plan](implementation-plan.md). Use versioned fixtures independent of developer `examples/`, with exact integer pitch/time assertions wherever possible.

## 1. Common fixture and evidence rules

Use a melodic pattern P in C ionian with original chord pitches `[60, 64, 67]`, a second pattern Q in A aeolian, a group G containing two distinct references to P and one to Q, and a supergroup S containing two distinct references to G. Use stable IDs for every reference. Add two linked Loop clips A and B with different starts and lengths, plus a cropped Once clip and an unrelated clip/lane.

Provide parallel score fixtures with stable note IDs, overlapping/off-scale pitches and hidden notes. Provide an arpeggiator fixture with a fixed seed and timestamped input notes. Add an instrument-automation lane to mixed-format persistence tests.

Each test must assert both output and ownership: which profile/reference/path changed, which linked objects retained identity, whether original payloads stayed byte-for-byte equal, and whether clip geometry/timing stayed unchanged. Native/persistence comparisons include hidden and unused data, not just currently audible content.

## 2. Musical golden vectors

Unless otherwise stated, root is C, mode ionian, `d` is the total diatonic shift and `c` the total chromatic shift. `omit` means no output voice/message.

| ID | Input | d | c | Expected output |
| --- | --- | ---: | ---: | --- |
| M01 | `[60, 64, 67]` | 0 | 0 | `[60, 64, 67]` |
| M02 | `[60, 64, 67]` | 1 | 0 | `[62, 65, 69]` |
| M03 | `[60, 64, 67]` | 0 | 1 | `[61, 65, 68]` |
| M04 | `[60, 64, 67]` | 2 | 12 | `[76, 79, 83]` |
| M05 | `60` | −1 | 0 | `59` |
| M06 | `60` | −8 | 0 | `47` |
| M07 | `61` (C sharp) | 1 | 0 | `63` (D sharp) |
| M08 | `61` | 3 | 0 | `66`; compute three degrees directly, not three materialized one-step edits |
| M09 | `[63, 64]` | 1 | 0 | Both map to `65`; event collision rules then apply |
| M10 | `120` | 7 | −12 | `120`; do not omit the intermediate 132 |
| M11 | `0` | 0 | −1 | omit |
| M12 | `127` | 0 | 1 | omit |
| M13 | `69`, A aeolian | 2 | 0 | `72` |
| M14 | Every pitch 0–127, every supported root/mode | 0 | 0 | Exact identity |
| M15 | Interior pitches, every supported root/mode | ±7 | 0 | Exactly ±12 semitones before final range filtering |

Also test non-C roots with pitches below the root class to exercise negative floor division; all valid signed component endpoints; separate pattern/group/supergroup contributions that sum to M04; and both components cancelling to identity. Persisting/loading or regrouping must not change the calculated total.

## 3. Shared profiles and independent offsets

| ID | Action | Required result |
| --- | --- | --- |
| S01 | Set P's shared repetitions to `[0, +2, +4, -1]` diatonic through A | A and B reference one canonical profile and sound those same indexed shifts |
| S02 | Edit repetition 3 through B | A updates at the corresponding logical repetition; original notes are unchanged |
| S03 | Make B shorter than repetition 3, edit that entry through A, then extend B | B reveals the shared edited entry; it was not deleted or made local |
| S04 | Add placement chromatic +12 to P in A | A is an octave above B; their shared profile link/values remain identical |
| S05 | Set a shared profile base to +2 and entry 1 explicitly to zero | Repetition 1 is unshifted; later unspecified repetitions use +2 |
| S06 | Clear that explicit entry | Repetition 1 inherits +2; clear is distinct from zero |
| S07 | Set an explicit entry equal to the base, then change the base | The explicit entry retains its old value |
| S08 | Set P's reference offset on the first P child in G | Every linked use of that child changes; second P child and standalone P retain their contextual values |
| S09 | Set G's offset on only the first G reference in S | Only that reference receives the offset; standalone G and the second reference do not |
| S10 | Add a full-path placement offset below the second G in clip A | No other G/P occurrence or clip changes |
| S11 | Set P, G and S contributions to M04 | Effective result is exactly `[76, 79, 83]`; Q uses its own A-aeolian theory |
| S12 | Place P twice in one content pass | Both read P's same logical repeat entry; they do not consume successive global profile entries |
| S13 | Adopt P into a new linked clip after editing its profile | The new clip immediately shares the existing profile |
| S14 | Edit a shared profile while another dependent draft is open | Stale save/impact data conflicts safely; unrelated drafts remain intact |

Assert the contribution breakdown and affected-link counts, not merely final pitches. Verify a repeat-specific change replaces that plan's base while remaining additive with other layers.

## 4. Time, repetition and structure

| ID | Scenario | Required result |
| --- | --- | --- |
| R01 | A/B start at different song positions | Their source repetitions 1, 2, 3 use the same profile indices |
| R02 | Crop a Loop clip to source offset 1.5 content cycles | First audible material reads logical index 1; the next pass reads 2 |
| R03 | Seek directly into repetition 4 | Correct profile entry is used without simulating earlier playback |
| R04 | Loop the song or a selected time range | Revisiting a source position reuses its original entry; no accumulated counter |
| R05 | Repeat a legacy cyclic lane | Each lane cycle reuses its authored logical indices |
| R06 | New Once clip versus first pass of Loop | Same entry 0 and pitches; Once becomes silent after content end |
| R07 | Isolate repetition 4 with the existing local musical save | Selected Once fragment uses repeat base 3; before/after fragments retain all corresponding settings |
| R08 | Split/copy a range through partial first and last repetitions | Equivalent source time has equivalent effective pitch after paste; local plans are independent copies and profiles remain shared |
| R09 | Shorten then lengthen a clip | Hidden entries and unused profiles survive |
| R10 | Change content duration using existing musical fixed-window behavior | Entry numbers stay unchanged; the crop's remapped visible passes match the documented impact preview |
| R11 | Structural growth with fractional source phase | Exact integer-rational phase/span rules and logical repeat alignment are preserved |
| R12 | Transpose-only edit of a generated pass | Clip count, lengths, offsets, note definitions and timeline order remain unchanged |
| R13 | Maximum-duration Loop with a few sparse replacements | Work/state does not scale with the number of virtual repeats |

Run these structural operations with both existing structural save scopes where supported:

| ID | Operation | Required result |
| --- | --- | --- |
| E01 | Group selected children under a new identity parent | Sound and child sharing unchanged; placement paths remapped |
| E02 | Ungroup a transposed group | Every default and explicit shared/contextual/local contribution survives as scoped snapshots; no note baking |
| E03 | Ungroup a transposed supergroup containing differently transposed groups | Identical effective pitches for every surviving logical pass; no leakage to other clips |
| E04 | Edit the removed container profile after E02/E03 | Ungrouped content no longer follows that removed parent; surviving child profiles still work |
| E05 | Reorder siblings or regenerate conflicting child IDs on a move | Plans follow the intended occurrence, not array positions or duplicate definitions |
| E06 | Move P between parents with different offsets | P's own settings survive; destination ancestry changes its effective result as previewed |
| E07 | Local musical fork of P | Chosen musical definition/profile becomes a variation; automatically forked ancestors retain their existing profile links |
| E08 | Delete a selected occurrence or whole clip | Only dependent placement paths disappear; reusable definitions/profiles remain |
| E09 | Undo/redo 25 mixed profile, local, structure and range edits | Exact identities, links, repeat bases, paths and values return, including after reload |
| E10 | Ungroup/composition would exceed a resource limit | Entire operation rejects; authored state/history/drafts remain recoverable |

## 5. Model and persistence validation

- **V01:** Reject fractional/NaN/nonfinite/boolean amounts or indices, out-of-bound components, negative indices and invalid derived repeat extents consistently in frontend/backend/CLI.
- **V02:** Reject missing/cross-lane profile references, duplicate IDs, duplicate/unsorted repetition entries, invalid placement paths and duplicate path records.
- **V03:** Reject transposition on rests, drummer/controller/automation lanes; keep those existing payloads unchanged when loading mixed performances.
- **V04:** Validate unused profiles/definitions and every bounded collection. A hidden item must not bypass a JSON, entry or preparation limit.
- **V05:** Round-trip shared profiles, independent contextual plans, placement plans, hidden repeat entries, unused profiles and nonzero repeat bases through Save/Load, autosave recovery, native export/import and CLI normalization.
- **V06:** Repeat V05 with instrument-bound automation and both controller datasets present. Clip v3 must retain v2 capabilities.
- **V07:** Old supported documents load as identity and retain their old format until an authored feature requires upgrade. The first change upgrades atomically. Returning visible offsets to zero does not silently downgrade away hidden data/history.
- **V08:** Unknown new versions and malformed runtime schedule v2 references fail explicitly; old code paths cannot save away transposition fields.
- **V09:** Invalid persistence/API writes leave the previous stored document untouched. Concurrent stale profile saves do not overwrite a newer revision.
- **V10:** Saved/serialized documents contain no prepared pads, pitch maps, active voices, pending live pairs, audition snapshots or unresolved drafts.
- **V11:** Compare frontend and standalone CLI wire schedules from the same fixtures, including plan deduplication-equivalent representations and exact repeat bases.
- **V12:** Near-limit histories preserve 25 actions without restoring whole-arrangement-per-action duplication. Keep existing persisted JSON budgets unchanged.

## 6. Playback, live edits and voice ownership

Use exact timestamped MIDI capture in the real runtime services. Test Python and rebuilt Cython kernels explicitly. Source/pad numbers alone are insufficient assertions because transformed variants must not create new authored slots.

| ID | Scenario | Required result |
| --- | --- | --- |
| P01 | Same pad repeated with alternating effective offsets | Every boundary selects the right variant despite unchanged pad identity |
| P02 | Melodic chord with holds, ratchets and timing offsets | Only pitches change; attack/release times, velocities and hold semantics remain correct |
| P03 | Strum with omitted/colliding pitches and 100% spread | Original per-tone schedule retained; equal-pitch ownership resolves deterministically |
| P04 | Off-scale score notes converge to one pitch | Stable same-pitch ordering and overlap handling; no orphaned releases |
| P05 | Seek into a sustained transposed score note | Chase the destination pitch for its remaining duration, clipped by existing boundaries |
| P06 | Clip ends mid-note; next occurrence uses another transpose | Release actual old output pitch; no stuck note or premature release of another source |
| P07 | Omitted out-of-range note | No attack, active-voice record or subsequent note-off |
| P08 | Save a transpose change mid-pattern | Current leaf retains its pinned pair; next leaf uses the latest successfully prepared pair |
| P09 | Rapid profile changes, then Stop | Superseded work never installs; pending application cancels; transport does not restart |
| P10 | Failed/over-budget preparation | Previous configuration continues; draft and useful error retained; no partial profile application |
| P11 | Seek/restart after P08 | Destination uses the latest prepared authored value immediately |
| P12 | Simultaneous musical and transpose edits | Existing musical update semantics remain; current occurrence keeps its previous pair without missing variants |
| P13 | Early attack or strum crosses a repeat boundary; another edit arrives after that attack is scheduled | Attack uses its owning occurrence's transform; that pair stays pinned for its remaining attacks, and the newer edit targets the next uncommitted occurrence |
| P14 | Muted/soloed lanes and independently active sources | Existing source ownership/gates remain correct; transforms do not alter routing |
| P15 | Unrelated identity-only lanes during transposition edits | Unchanged output, phase and preparation reuse |

Arpeggiator-specific cases:

- **A01:** Deterministic injected input demonstrates existing built-in transpose/quantizer followed by the new mapping. Chromatic results are not quantized back afterward.
- **A02:** The new diatonic layer uses configured pattern theory even when the earlier quantizer follows source theory; help/status identifies both correctly.
- **A03:** Same-pad repeat change updates output mapping while retaining input-held-note ownership, intended rhythm phase and deterministic random behavior.
- **A04:** Bypass forwards according to existing bypass semantics without the new processing; mute/stopped remain silent.
- **A05:** Omitted/merged output pitches produce matching generated-note previews and balanced releases.
- **A06:** Upstream sequencer and downstream arp each transform once at their own stage; no accidental double application within either source.

## 7. Audition, exports and UI

| ID | Workflow | Required result |
| --- | --- | --- |
| U01 | Select P inside S/G at repetition 3 and Play edit | Hear its own and all enclosing contributions for index 2; audition repeats that selected index |
| U02 | Play edit on G/S with descendant offsets | Descendant timing/rests and effective pitches match the selected context |
| U03 | Enter/exit audition while song plays, seek, Stop edit | Correct source ownership and restoration at current song phase/transform |
| U04 | Change transpose/structure draft during snapshot audition | No silent new snapshot; refresh/restart required; ordinary musical live behavior retained |
| U05 | Save/export with unresolved transpose draft | Existing resolve/use-saved flow applies; draft settings never leak into exported music |
| U06 | Edit shared repeat versus placement repeat | Owner, affected uses and effective result are distinct and correct in the inspector/dialog |
| U07 | Switch Diatonic/Chromatic displayed component | Units switch without converting/erasing the other component; both nonzero contributions remain visible |
| U08 | Set zero, clear entry, reset component/plan, cancel | Each has the specified distinct effect and atomic history behavior |
| U09 | Musical editor and timeline preview | Editor notes remain authored; melodic/score Note maps show effective pitch; arp timeline remains parameter-only |
| U10 | Collapse/expand, scroll/zoom, status updates | Draft/selection preserved; hidden visual work suspended; no configuration resubmission |
| U11 | Narrow viewport, keyboard-only, text zoom, all four UI languages | Controls and scope remain usable; signed values/units and accessible names unambiguous |
| U12 | Play edit on a pattern visible only through a partial clip crop | Full selected definition auditions from its own start using the selected logical index; arranged playback still honors the crop |
| U13 | Inspect expanded pattern/group/supergroup boxes and compact pattern previews | Active badges show signed effective D/C totals, including enclosing offsets; zero/narrow boxes expose an accessible ↕ control |
| U14 | Click a generated repetition badge and save shared or placement changes | Correct logical repetition and scope; linked clips update for shared edits, placement changes remain local; one undo/redo action; no musical editor selection change |
| U15 | Close/Escape a dirty lane dialog, reopen and discard | Draft survives closure, amber asterisk identifies it, saved totals remain unchanged, focus returns to trigger; Discard resolves only transposition work |
| U16 | Edit from the lane while another musical draft exists; reopen a clean dialog after a shared musical edit | Unfinished music and editor selection survive; clean snapshots refresh to the latest definition |

For **X01**, compare deterministic live events with MIDI CSD collection and SCORE CSD events from the same authored fixture, including crop/range-start sustain, transposed collisions and arpeggiator input. Compare pitches, times, channels, velocities and releases; account explicitly for existing format-level representation differences.

For **X02**, native export/import must preserve both profile identity sharing and contextual independence, not merely identical output on one pass. Repeat S02 after importing to prove the link is still live.

For **X03**, verify existing instrument/asset selection, mixer/controller seeding, direct-output routing and effect tails are unchanged. Static export estimates remain within enforced limits.

Capture screenshots for nested offsets, shared repeat editing, local placement scope and cropped repetition numbering. Run actual production-browser/Csound checks against isolated fixture data. Label screenshot-only/harness checks separately from real audio runtime evidence; do not claim subjective listening or external MIDI hardware verification unless performed.

## 8. Performance and release evidence

Measure these cases against the T1 baseline with identical hardware/process settings and repeated samples:

| Case | Required observation |
| --- | --- |
| All identity settings | No material regression in existing preparation or render/boundary workload |
| One shared repetition entry changed | Unchanged base/variant data reused; no rebuilding every virtual pass |
| Long Loop with few explicit replacements | Bounded memory/preparation independent of loop duration |
| Many clips sharing one pattern/profile | Prepared equivalent variants shared rather than duplicated per clip |
| Dense score under several effective pairs | Record cold/cached/changed preparation, serialized size and retained memory; enforce transformed-record budgets |
| Maximum-depth groups and sparse plans | Bounded union and lookup; reject limit-plus-one before expensive allocation |
| Fast repeated saves, seeks and cancellations | No orphaned preparations, unbounded cache growth or refill starvation |
| Collapsed/offscreen expanded arrangement | Visible-range work only; playback/status does not generate new configurations |

Record medians, high percentiles and maxima, plus sample counts and render block duration. As an initial investigation threshold, flag a repeatable >10% median regression in the matched identity baseline; do not call noisy sub-resolution changes a regression or treat the threshold alone as audio-safety proof. New render-path workloads must fit the actual block budget under the supported stress fixture. Record any platform limitation and tighten budgets if necessary before enabling authoring.

Release evidence must include frontend full checks, relevant/full backend checks, rebuilt-kernel parity, CLI tests, API/native/export tests, browser workflows, current documentation/screenshots and Markdown/link checks. Report failures and unperformed checks explicitly. None of this package's future tests are satisfied by the earlier feasibility probe or by historical clip-arranger results.
