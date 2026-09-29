import type { PatchListItem, SequencerInstrumentBinding } from "../types";

type RackPatches = ReadonlyMap<string, Pick<PatchListItem, "always_on">>;
export type RackInstrumentBindingRow = { binding: SequencerInstrumentBinding; index: number };

export function groupRackInstruments(bindings: SequencerInstrumentBinding[], patches: RackPatches) {
  const standard: RackInstrumentBindingRow[] = [];
  const alwaysOn: RackInstrumentBindingRow[] = [];
  bindings.forEach((binding, index) => {
    (patches.get(binding.patchId)?.always_on === true ? alwaysOn : standard).push({ binding, index });
  });
  return { standard, alwaysOn };
}

export function canReorderRackInstruments(
  bindings: SequencerInstrumentBinding[], patches: RackPatches, sourceId: string, targetId: string
): boolean {
  const source = bindings.find(binding => binding.id === sourceId);
  const target = bindings.find(binding => binding.id === targetId);
  return !!source && !!target && sourceId !== targetId &&
    (patches.get(source.patchId)?.always_on === true) === (patches.get(target.patchId)?.always_on === true);
}

export function reorderRackInstruments(
  bindings: SequencerInstrumentBinding[], patches: RackPatches,
  sourceId: string, targetId: string, position: "before" | "after"
): SequencerInstrumentBinding[] {
  if (!canReorderRackInstruments(bindings, patches, sourceId, targetId)) return bindings;
  const groups = groupRackInstruments(bindings, patches);
  const group = groups.standard.some(row => row.binding.id === sourceId) ? groups.standard : groups.alwaysOn;
  const source = group.find(row => row.binding.id === sourceId)!;
  const remaining = group.filter(row => row !== source);
  const targetIndex = remaining.findIndex(row => row.binding.id === targetId);
  remaining.splice(targetIndex + (position === "after" ? 1 : 0), 0, source);
  if (remaining.every((row, index) => row === group[index])) return bindings;

  // Keep the other group's slots intact, including in older interleaved configurations.
  const reordered = [...bindings];
  group.forEach((row, index) => { reordered[row.index] = remaining[index].binding; });
  return reordered;
}
