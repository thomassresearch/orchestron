import type { Patch, PatchListItem, PerformanceListItem, SequencerConfigSnapshot } from "../types";

export function normalizeNameKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function findPatchByName(patches: PatchListItem[], name: string): PatchListItem | null {
  const target = normalizeNameKey(name);
  if (target.length === 0) {
    return null;
  }
  return patches.find((patch) => normalizeNameKey(patch.name) === target) ?? null;
}

export function findPerformanceByName(
  performances: PerformanceListItem[],
  name: string
): PerformanceListItem | null {
  const target = normalizeNameKey(name);
  if (target.length === 0) {
    return null;
  }
  return performances.find((performance) => normalizeNameKey(performance.name) === target) ?? null;
}

export function suggestUniqueCopyName(baseName: string, isTaken: (candidate: string) => boolean): string {
  const seed = baseName.trim().length > 0 ? baseName.trim() : "Imported";
  let index = 1;
  let candidate = `${seed} Copy`;
  while (isTaken(candidate)) {
    index += 1;
    candidate = `${seed} Copy ${index}`;
  }
  return candidate;
}

export function toPatchListItem(patch: Patch): PatchListItem {
  return {
    id: patch.id,
    name: patch.name,
    description: patch.description,
    schema_version: patch.schema_version,
    updated_at: patch.updated_at
  };
}

export function remapSnapshotPatchIds(
  snapshot: SequencerConfigSnapshot,
  patchIdMap: Map<string, string>,
  patches: PatchListItem[]
): SequencerConfigSnapshot {
  return {
    ...snapshot,
    instruments: snapshot.instruments.map((instrument) => {
      const mappedPatchId = patchIdMap.get(instrument.patchId);
      if (mappedPatchId) {
        return {
          ...instrument,
          patchId: mappedPatchId
        };
      }

      if (typeof instrument.patchName === "string" && instrument.patchName.trim().length > 0) {
        const existing = findPatchByName(patches, instrument.patchName);
        if (existing) {
          return {
            ...instrument,
            patchId: existing.id
          };
        }
      }

      return instrument;
    })
  };
}
