import { ClipError, validateArrangement, type ClipArrangement, type ClipHistory, type ClipHistoryChange, type ClipHistoryEntry, type LaneTiming } from "./model";

const clone = <T>(value: T): T => structuredClone(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a).filter(key => a[key] !== undefined);
  return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length && keys.every(key => equal(a[key], b[key]));
}
export const emptyClipHistory = (): ClipHistory => ({ version: 2, cursor: 0, basis: null, entries: [] });

/** Diff inside fixed step arrays as well as definitions: changing one cell stores one cell's fields. */
function changesBetween(before: unknown, after: unknown, path: (string | number)[] = []): ClipHistoryChange[] {
  if (equal(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const common = Math.min(before.length, after.length);
    const changes = before.slice(0, common).flatMap((value, index) => changesBetween(value, after[index], [...path, index]));
    if (before.length !== after.length) changes.push({ kind: "splice", path, index: common, before: clone(before.slice(common)), after: clone(after.slice(common)) });
    return changes;
  }
  if (object(before) && object(after)) return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .flatMap(key => changesBetween(before[key], after[key], [...path, key]));
  return [{ kind: "replace", path, ...(before !== undefined ? { before: clone(before) } : {}), ...(after !== undefined ? { after: clone(after) } : {}) }];
}

function conflict(): never { throw new ClipError("conflict", "The arrangement changed outside this history."); }
function child(value: unknown, key: string | number, allowMissing = false): unknown {
  if (Array.isArray(value)) {
    if (typeof key !== "number" || !Number.isInteger(key) || key < 0 || key >= value.length) conflict();
    return value[key];
  }
  if (!object(value) || typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) conflict();
  if (!Object.prototype.hasOwnProperty.call(value, key) && !allowMissing) conflict();
  return value[key];
}

function applyEntry(model: ClipArrangement, entry: ClipHistoryEntry, forward: boolean): ClipArrangement {
  const next = clone(model);
  for (const change of forward ? entry.changes : [...entry.changes].reverse()) {
    if (!Array.isArray(change.path) || !change.path.length || change.path.length > 64) conflict();
    const expected = forward ? change.before : change.after, replacement = forward ? change.after : change.before;
    if (change.kind === "splice") {
      const target = change.path.reduce<unknown>((value, key) => child(value, key), next);
      if (!Array.isArray(target) || !Array.isArray(expected) || !Array.isArray(replacement) || !Number.isInteger(change.index) ||
          change.index < 0 || target.length !== change.index + expected.length || !equal(target.slice(change.index), expected)) conflict();
      // Only the tail changes length; earlier elements have their own reversible changes.
      target.splice(change.index, expected.length);
      for (const value of replacement) target.push(clone(value));
    } else if (change.kind === "replace") {
      const parent = change.path.slice(0, -1).reduce<unknown>((value, key) => child(value, key), next);
      const key = change.path[change.path.length - 1];
      if (!equal(child(parent, key, true), expected) || expected === undefined && replacement === undefined) conflict();
      if (Array.isArray(parent)) {
        if (replacement === undefined) conflict();
        parent[key as number] = clone(replacement);
      } else {
        const target = parent as Record<string, unknown>;
        if (replacement === undefined) delete target[key];
        else target[key] = clone(replacement);
      }
    } else conflict();
  }
  return next;
}

export function recordClipEdit(history: ClipHistory, before: ClipArrangement, after: ClipArrangement, label: string, timings: LaneTiming = {}): ClipHistory {
  // Also handles a pre-upgrade history still held by a live development browser.
  const current = history.version === 2 ? history : readClipHistory(history, before, timings);
  const entries = current.entries.length && !equal(current.basis, before) ? [] : current.entries.slice(0, current.cursor);
  entries.push({ label, changes: changesBetween(before, after) });
  return { version: 2, cursor: Math.min(entries.length, 25), basis: clone(after), entries: entries.slice(-25) };
}

/** Current in-memory histories are already validated; migrate old live state at either write boundary. */
export function clipHistoryForPersistence(value: ClipHistory | undefined, model: ClipArrangement, timings: LaneTiming): ClipHistory {
  return value?.version === 2 ? clone(value) : readClipHistory(value, model, timings);
}

export function replayClipEdit(history: ClipHistory, model: ClipArrangement, forward: boolean, timings: LaneTiming = {}): { model: ClipArrangement; history: ClipHistory } {
  if (history.version !== 2) history = readClipHistory(history, model, timings);
  const entry = history.entries[forward ? history.cursor : history.cursor - 1];
  if (!entry) return { model, history };
  if (!equal(model, history.basis)) conflict();
  const next = applyEntry(model, entry, forward);
  return { model: next, history: { ...history, basis: clone(next), cursor: history.cursor + (forward ? 1 : -1) } };
}

/** Validate both sides of the cursor, including every transition, before accepting optional metadata. */
export function readClipHistory(value: unknown, model: ClipArrangement, timings: LaneTiming): ClipHistory {
  try {
    if (!object(value) || value.version !== 1 && value.version !== 2 || !Array.isArray(value.entries) || value.entries.length > 25 ||
        !Number.isInteger(value.cursor) || Number(value.cursor) < 0 || Number(value.cursor) > value.entries.length) return emptyClipHistory();
    if (!value.entries.length) return emptyClipHistory();
    const validate = (snapshot: ClipArrangement) => {
      validateArrangement(snapshot, timings);
      if (snapshot.lanes.length !== model.lanes.length || snapshot.lanes.some(lane => !model.lanes.some(current => current.id === lane.id && current.source === lane.source))) conflict();
    };
    const cursor = Number(value.cursor);
    let history: ClipHistory;
    if (value.version === 1) {
      const legacy = value.entries as { label: string; before: ClipArrangement; after: ClipArrangement }[];
      for (const [index, entry] of legacy.entries()) {
        validate(entry.before); validate(entry.after);
        if (index && !equal(legacy[index - 1].after, entry.before)) conflict();
      }
      if (!equal(model, cursor ? legacy[cursor - 1].after : legacy[0].before)) conflict();
      history = { version: 2, cursor, basis: clone(model), entries: legacy.map(entry => ({ label: entry.label, changes: changesBetween(entry.before, entry.after) })) };
    } else {
      history = clone(value) as unknown as ClipHistory;
      if (!equal(history.basis, model)) conflict();
    }
    for (const entry of history.entries) {
      if (typeof entry.label !== "string" || entry.label.length > 256 || !Array.isArray(entry.changes)) conflict();
    }
    validate(model);
    let previous = model, future = model;
    for (let i = cursor - 1; i >= 0; i--) { previous = applyEntry(previous, history.entries[i], false); validate(previous); }
    for (let i = cursor; i < history.entries.length; i++) { future = applyEntry(future, history.entries[i], true); validate(future); }
    return history;
  } catch { return emptyClipHistory(); }
}
