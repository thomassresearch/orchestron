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
    is_template: patch.is_template,
    always_on: patch.always_on,
    audio_inlet_names: literalAudioPortNames(patch, "inleta"),
    audio_outlet_names: literalAudioPortNames(patch, "outleta"),
    schema_version: patch.schema_version,
    updated_at: patch.updated_at
  };
}

function literalAudioPortNames(patch: Patch, opcode: "inleta" | "outleta"): string[] {
  const names = new Set<string>();
  const nodesById = new Map(patch.graph.nodes.map((node) => [node.id, node]));
  const connectionsByTarget = new Map<string, Array<{ sourceNodeId: string; sourcePortId: string }>>();
  for (const connection of patch.graph.connections) {
    if (connection.to_port_id !== "sname") {
      continue;
    }
    const entries = connectionsByTarget.get(connection.to_node_id) ?? [];
    entries.push({ sourceNodeId: connection.from_node_id, sourcePortId: connection.from_port_id });
    connectionsByTarget.set(connection.to_node_id, entries);
  }

  for (const node of patch.graph.nodes) {
    if (node.opcode !== opcode) {
      continue;
    }
    const connectedNames = new Set<string>();
    for (const connection of connectionsByTarget.get(node.id) ?? []) {
      const sourceNode = nodesById.get(connection.sourceNodeId);
      if (connection.sourcePortId === "sout" && sourceNode?.opcode === "const_s") {
        const rawValue = sourceNode.params.value;
        if (typeof rawValue === "string" && rawValue.trim().length > 0) {
          connectedNames.add(rawValue.trim());
        }
      }
    }
    if (connectedNames.size > 0) {
      for (const name of connectedNames) {
        names.add(name);
      }
      continue;
    }
    if (connectionsByTarget.has(node.id)) {
      continue;
    }
    const rawName = node.params.sname;
    if (typeof rawName === "string" && rawName.trim().length > 0) {
      names.add(rawName.trim());
    }
  }
  return [...names].sort();
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
        const existing = findPatchByName(
          patches.filter((patch) => patch.is_template !== true),
          instrument.patchName
        );
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
