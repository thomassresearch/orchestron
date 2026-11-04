import { describe, expect, it } from "vitest";
import { emptyClipHistory, readClipHistory, recordClipEdit, replayClipEdit } from "./history";
import { arrangementTimings, migrateClipArrangement } from "./migration";
import type { ClipArrangement, ClipHistory } from "./model";
import { buildPersistedAppStateSnapshot, buildSequencerConfigSnapshot, defaultControllerSequencer, defaultDrummerSequencerTrack, defaultSequencerState, normalizeSequencerState, parseSequencerConfigSnapshot } from "../../store/appStoreModel";
import { useAppStore } from "../../store/useAppStore";

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
function fixture() {
  const state = defaultSequencerState();
  state.drummerTracks = [defaultDrummerSequencerTrack(1)];
  state.controllerSequencers = [defaultControllerSequencer(1)];
  for (const track of [...state.tracks, ...state.drummerTracks, ...state.controllerSequencers]) {
    track.padLoopEnabled = true;
    track.padLoopPattern.rootSequence = [{ type: "pad", padIndex: 0 }];
  }
  state.clipArrangement = migrateClipArrangement(state).model!;
  return state;
}
function edit(model: ClipArrangement, index: number): ClipArrangement {
  const next = structuredClone(model);
  next.revision++;
  const drum = next.lanes.find(lane => lane.source === "drummer")!;
  const pattern = drum.definitions[0];
  if (pattern.kind === "pattern" && pattern.source === "drummer") {
    pattern.payload.rows[0].steps[index % 128].velocity = index + 1;
    pattern.revision++;
  }
  // Timeline and controller edits share a transaction with a musical change.
  drum.clips[0].name = `Drums ${index}`;
  const controller = next.lanes.find(lane => lane.source === "controller")!.definitions[0];
  if (controller.kind === "pattern" && controller.source === "controller") controller.payload.keypoints[0].value = index;
  return next;
}

describe("compact clip undo history", () => {
  it("keeps a dense drum/controller performance small through 25 edits, both persistence paths and full replay", () => {
    const state = fixture(), timings = arrangementTimings(state);
    const snapshots = [structuredClone(state.clipArrangement!)];
    let history = emptyClipHistory();
    for (let i = 0; i < 25; i++) {
      const next = edit(snapshots[i], i);
      history = recordClipEdit(history, snapshots[i], next, `Edit ${i}`);
      snapshots.push(next);
    }
    state.clipArrangement = snapshots[25]; state.clipHistory = history;
    const legacy = { version: 1, cursor: 25, entries: snapshots.slice(1).map((after, i) => ({ label: `Edit ${i}`, before: snapshots[i], after })) };
    expect(size(legacy)).toBeGreaterThan(8 * 1024 * 1024);
    expect(size(history)).toBeLessThan(size(state.clipArrangement) + 50000);
    const saved = json(buildSequencerConfigSnapshot(state, []));
    const app = json(buildPersistedAppStateSnapshot({ ...useAppStore.getInitialState(), sequencer: state }));
    expect(size(saved)).toBeLessThan(2 * 1024 * 1024);
    expect(size(app)).toBeLessThan(2 * 1024 * 1024);
    for (const restored of [parseSequencerConfigSnapshot(saved, [], null).sequencer, normalizeSequencerState(app.sequencer)]) {
      expect(restored.clipHistory?.entries).toHaveLength(25);
      let current = { model: restored.clipArrangement!, history: restored.clipHistory! };
      for (let i = 24; i >= 0; i--) {
        current = replayClipEdit(current.history, current.model, false);
        expect(current.model).toEqual(snapshots[i]);
      }
      // Reload at the undo boundary, including its full redo stack.
      current.history = readClipHistory(json(current.history), current.model, timings);
      for (let i = 1; i <= 25; i++) {
        current = replayClipEdit(current.history, current.model, true);
        expect(current.model).toEqual(snapshots[i]);
      }
    }
    // Old in-memory state is compacted by Save and autosave, without mutating it.
    const oldState = { ...state, clipHistory: legacy as unknown as ClipHistory };
    expect(size(buildSequencerConfigSnapshot(oldState, []))).toBeLessThan(2 * 1024 * 1024);
    expect(size(buildPersistedAppStateSnapshot({ ...useAppStore.getInitialState(), sequencer: oldState }))).toBeLessThan(2 * 1024 * 1024);
    expect(legacy.version).toBe(1);
  });

  it.each([0, 1, 2])("migrates legacy snapshots with cursor %i and preserves undo and redo", cursor => {
    const state = fixture(), before = state.clipArrangement!, middle = edit(before, 0), after = edit(middle, 1);
    const states = [before, middle, after];
    const legacy = { version: 1, cursor, entries: [{ label: "First", before, after: middle }, { label: "Second", before: middle, after }] };
    const saved = json(buildSequencerConfigSnapshot({ ...state, clipArrangement: states[cursor] }, []));
    Object.assign(saved.sequencer, { clipHistory: legacy });
    const restored = parseSequencerConfigSnapshot(saved, [], null).sequencer;
    expect(restored.clipHistory).toMatchObject({ version: 2, cursor });
    expect(restored.clipHistory?.entries).toHaveLength(2);
    let current = { model: restored.clipArrangement!, history: restored.clipHistory! };
    for (let i = cursor; i > 0; i--) current = replayClipEdit(current.history, current.model, false);
    expect(current.model).toEqual(before);
    for (let i = 0; i < 2; i++) current = replayClipEdit(current.history, current.model, true);
    expect(current.model).toEqual(after);
  });

  it("reverses inserted/deleted definitions, optional fields and reordered lanes without losing hidden cells", () => {
    const before = fixture().clipArrangement!, after = structuredClone(before);
    after.revision++;
    after.lanes.reverse();
    const lane = after.lanes.find(lane => lane.source === "drummer")!;
    lane.definitions[0].color = "#123456";
    lane.definitions.splice(2, 1);
    const variation = structuredClone(lane.definitions[0]);
    variation.id = "variation";
    lane.definitions.push(variation);
    const pattern = lane.definitions[0];
    if (pattern.kind === "pattern" && pattern.source === "drummer") pattern.payload.rows[0].steps[127].active = true;
    let history = recordClipEdit(emptyClipHistory(), before, after, "Variation");
    history = readClipHistory(json(history), after, {});
    expect(history.entries).toHaveLength(1);
    const undone = replayClipEdit(history, after, false);
    expect(undone.model).toEqual(before);
    expect(replayClipEdit(undone.history, undone.model, true).model).toEqual(after);
    const removed = structuredClone(after);
    removed.revision++;
    delete removed.lanes.find(lane => lane.source === "drummer")!.definitions[0].color;
    removed.lanes[0].definitions.pop();
    history = recordClipEdit(history, after, removed, "Remove unused definition");
    const reloaded = readClipHistory(json(history), removed, {});
    expect(replayClipEdit(reloaded, removed, false).model).toEqual(after);
  });

  it("evicts the oldest action after 25 and discards only the redo branch on a new edit", () => {
    let model = fixture().clipArrangement!, history = emptyClipHistory();
    const snapshots = [model];
    for (let i = 0; i < 30; i++) {
      const next = edit(model, i);
      history = recordClipEdit(history, model, next, `Edit ${i}`); model = next; snapshots.push(next);
    }
    expect(history.entries).toHaveLength(25);
    let current = { model, history };
    for (let i = 0; i < 25; i++) current = replayClipEdit(current.history, current.model, false);
    expect(current.model).toEqual(snapshots[5]);
    current = replayClipEdit(current.history, current.model, true);
    const fork = edit(current.model, 60);
    history = recordClipEdit(current.history, current.model, fork, "Fork");
    expect(history.entries).toHaveLength(2);
    expect(replayClipEdit(history, fork, false).model).toEqual(snapshots[6]);
  });

  it("rejects stale, malformed, discontinuous and unsafe histories without losing the music", () => {
    const state = fixture(), before = state.clipArrangement!, after = edit(before, 0);
    const history = recordClipEdit(emptyClipHistory(), before, after, "Edit");
    const bad = (mutate: (h: ClipHistory) => void) => {
      const corrupt = json(history); mutate(corrupt);
      expect(readClipHistory(corrupt, after, {}).entries).toHaveLength(0);
    };
    bad(h => { h.entries[0].changes[0].before = -1; });
    bad(h => { h.entries[0].changes[0].path = ["__proto__", "polluted"]; });
    bad(h => { h.entries[0].changes[0].path = ["lanes", -1]; });
    bad(h => { h.basis!.end++; });
    bad(h => { h.entries[0].label = "x".repeat(257); });
    const stale = structuredClone(after); stale.end++;
    expect(() => replayClipEdit(history, stale, false)).toThrow(/outside/);
    const broken = { version: 1, cursor: 2, entries: [{ label: "First", before, after }, { label: "Second", before, after }] };
    expect(readClipHistory(broken, after, {})).toEqual(emptyClipHistory());
    const saved = json(buildSequencerConfigSnapshot({ ...state, clipArrangement: after, clipHistory: history }, []));
    saved.sequencer.clipHistory!.entries[0].changes[0].before = -1;
    const restored = parseSequencerConfigSnapshot(saved, [], null).sequencer;
    expect(restored.clipArrangement).toEqual(after);
    expect(restored.clipHistory).toEqual(emptyClipHistory());
  });
});
