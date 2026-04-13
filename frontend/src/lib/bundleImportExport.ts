import type {
  Patch,
  PatchGraph,
  PatchListItem,
  PerformanceListItem,
  SequencerConfigSnapshot,
  SessionSequencerConfigRequest
} from "../types";

import type { ImportConflictDialogItem } from "./importDialogs";
import {
  findPatchByName,
  findPerformanceByName,
  remapSnapshotPatchIds,
  suggestUniqueCopyName
} from "./patchCatalog";

const DEFAULT_IMPORTED_PATCH_NAME = "Imported Patch";
const DEFAULT_IMPORTED_PERFORMANCE_NAME = "Imported Performance";
const DEFAULT_EXPORTED_PERFORMANCE_NAME = "Untitled Performance";

export interface ExportedPatchDefinition {
  sourcePatchId: string;
  name: string;
  description: string;
  schema_version: number;
  graph: PatchGraph;
}

export interface ExportedPerformanceDocument {
  name: string;
  description: string;
  config: SequencerConfigSnapshot;
}

export interface PerformanceExportPayload {
  format: "orchestron.performance";
  version: 1;
  exported_at: string;
  performance: ExportedPerformanceDocument;
  patch_definitions: ExportedPatchDefinition[];
}

export interface PerformanceCsdExportRequestPayload {
  performanceExport: PerformanceExportPayload;
  sequencerConfig: SessionSequencerConfigRequest;
}

type PatchWritePayload = {
  name: string;
  description: string;
  schema_version: number;
  graph: PatchGraph;
};

type PerformanceWritePayload = {
  name: string;
  description: string;
  config: SequencerConfigSnapshot;
};

export type PatchImportOperation =
  | {
      type: "skip";
    }
  | {
      type: "create";
      payload: PatchWritePayload;
    }
  | {
      type: "update";
      patchId: string;
      payload: PatchWritePayload;
    };

export type PerformanceImportOperation =
  | {
      type: "create";
      payload: PerformanceWritePayload;
    }
  | {
      type: "update";
      performanceId: string;
      payload: PerformanceWritePayload;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function exportedPatchDefinitionName(definition: ExportedPatchDefinition): string {
  return definition.name.trim().length > 0 ? definition.name.trim() : DEFAULT_IMPORTED_PATCH_NAME;
}

export function exportedPerformanceName(exported: PerformanceExportPayload): string {
  return exported.performance.name.trim().length > 0
    ? exported.performance.name.trim()
    : DEFAULT_IMPORTED_PERFORMANCE_NAME;
}

export function parseExportedPatchDefinition(raw: unknown): ExportedPatchDefinition | null {
  if (!isRecord(raw) || !isRecord(raw.graph)) {
    return null;
  }

  const sourcePatchId = typeof raw.sourcePatchId === "string" ? raw.sourcePatchId.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const description = typeof raw.description === "string" ? raw.description : "";
  const schemaVersion =
    typeof raw.schema_version === "number" && Number.isFinite(raw.schema_version)
      ? Math.max(1, Math.round(raw.schema_version))
      : 1;

  if (sourcePatchId.length === 0 || name.length === 0) {
    return null;
  }

  return {
    sourcePatchId,
    name,
    description,
    schema_version: schemaVersion,
    graph: raw.graph as unknown as PatchGraph
  };
}

export function parsePerformanceExportPayload(raw: unknown): PerformanceExportPayload | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.format !== "orchestron.performance") {
    return null;
  }
  const version = typeof raw.version === "number" ? Math.round(raw.version) : NaN;
  if (version !== 1) {
    return null;
  }
  if (!isRecord(raw.performance)) {
    return null;
  }

  const rawPatchDefinitions = Array.isArray(raw.patch_definitions) ? raw.patch_definitions : [];
  const parsedPatchDefinitions = rawPatchDefinitions
    .map((entry) => parseExportedPatchDefinition(entry))
    .filter((entry): entry is ExportedPatchDefinition => entry !== null);

  const performanceName =
    typeof raw.performance.name === "string" && raw.performance.name.trim().length > 0
      ? raw.performance.name.trim()
      : DEFAULT_IMPORTED_PERFORMANCE_NAME;
  const performanceDescription = typeof raw.performance.description === "string" ? raw.performance.description : "";

  return {
    format: "orchestron.performance",
    version: 1,
    exported_at: typeof raw.exported_at === "string" ? raw.exported_at : new Date().toISOString(),
    performance: {
      name: performanceName,
      description: performanceDescription,
      config: raw.performance.config as SequencerConfigSnapshot
    },
    patch_definitions: parsedPatchDefinitions
  };
}

export function extractImportPatchDefinitions(raw: unknown): ExportedPatchDefinition[] {
  const standalonePatchDefinition = parseExportedPatchDefinition(raw);
  if (standalonePatchDefinition) {
    return [standalonePatchDefinition];
  }

  return parsePerformanceExportPayload(raw)?.patch_definitions ?? [];
}

export function buildPerformanceExportPayload(params: {
  snapshot: SequencerConfigSnapshot;
  selectedPatches: Patch[];
  performanceName: string;
  performanceDescription: string;
}): { exportedPerformanceName: string; payload: PerformanceExportPayload } {
  const patchDefinitions: ExportedPatchDefinition[] = params.selectedPatches.map((patch) => ({
    sourcePatchId: patch.id,
    name: patch.name,
    description: patch.description,
    schema_version: patch.schema_version,
    graph: patch.graph
  }));

  const patchNameById = new Map(patchDefinitions.map((patch) => [patch.sourcePatchId, patch.name]));
  const exportConfig: SequencerConfigSnapshot = {
    ...params.snapshot,
    instruments: params.snapshot.instruments.map((instrument) => ({
      ...instrument,
      patchName: patchNameById.get(instrument.patchId) ?? instrument.patchName
    }))
  };

  const exportedPerformanceName =
    params.performanceName.trim().length > 0 ? params.performanceName.trim() : DEFAULT_EXPORTED_PERFORMANCE_NAME;

  return {
    exportedPerformanceName,
    payload: {
      format: "orchestron.performance",
      version: 1,
      exported_at: new Date().toISOString(),
      performance: {
        name: exportedPerformanceName,
        description: params.performanceDescription,
        config: exportConfig
      },
      patch_definitions: patchDefinitions
    }
  };
}

export function collectPatchImportConflictItems(
  patchDefinitions: ExportedPatchDefinition[],
  patches: PatchListItem[]
): ImportConflictDialogItem[] {
  return patchDefinitions.flatMap((definition) => {
    const incomingName = exportedPatchDefinitionName(definition);
    const existing = findPatchByName(patches, incomingName);
    if (!existing) {
      return [];
    }

    return [
      {
        id: `patch:${definition.sourcePatchId}`,
        kind: "patch",
        sourcePatchId: definition.sourcePatchId,
        originalName: incomingName,
        overwrite: true,
        targetName: suggestUniqueCopyName(incomingName, (candidate) => findPatchByName(patches, candidate) !== null),
        skip: false
      }
    ];
  });
}

export function collectPerformanceImportConflictItems(
  exported: PerformanceExportPayload,
  performances: PerformanceListItem[]
): ImportConflictDialogItem[] {
  const incomingName = exportedPerformanceName(exported);
  const existingPerformance = findPerformanceByName(performances, incomingName);
  if (!existingPerformance) {
    return [];
  }

  return [
    {
      id: "performance",
      kind: "performance",
      originalName: incomingName,
      overwrite: true,
      targetName: suggestUniqueCopyName(
        incomingName,
        (candidate) => findPerformanceByName(performances, candidate) !== null
      ),
      skip: false
    }
  ];
}

export function partitionImportConflictItems(items: ImportConflictDialogItem[]): {
  patchConflictsBySourceId: Map<string, ImportConflictDialogItem>;
  performanceConflict: ImportConflictDialogItem | null;
} {
  const patchConflictsBySourceId = new Map<string, ImportConflictDialogItem>();
  let performanceConflict: ImportConflictDialogItem | null = null;

  for (const item of items) {
    if (item.kind === "patch" && item.sourcePatchId) {
      patchConflictsBySourceId.set(item.sourcePatchId, item);
      continue;
    }
    if (item.kind === "performance") {
      performanceConflict = item;
    }
  }

  return {
    patchConflictsBySourceId,
    performanceConflict
  };
}

export function resolvePatchImportOperation(
  definition: ExportedPatchDefinition,
  patches: PatchListItem[],
  patchConflictsBySourceId: Map<string, ImportConflictDialogItem>
): PatchImportOperation {
  const conflictItem = patchConflictsBySourceId.get(definition.sourcePatchId);
  if (conflictItem?.skip) {
    return { type: "skip" };
  }

  const incomingName = exportedPatchDefinitionName(definition);
  const existingPatch = findPatchByName(patches, incomingName);
  const payload: PatchWritePayload = {
    name: incomingName,
    description: definition.description,
    schema_version: definition.schema_version,
    graph: definition.graph
  };

  if (existingPatch && (!conflictItem || conflictItem.overwrite)) {
    return {
      type: "update",
      patchId: existingPatch.id,
      payload
    };
  }

  if (existingPatch && conflictItem) {
    return {
      type: "create",
      payload: {
        ...payload,
        name: conflictItem.targetName.trim()
      }
    };
  }

  return {
    type: "create",
    payload
  };
}

export function resolveImportedPerformanceConfig(
  exported: PerformanceExportPayload,
  patchIdMap: Map<string, string>,
  patches: PatchListItem[]
): SequencerConfigSnapshot {
  return remapSnapshotPatchIds(exported.performance.config, patchIdMap, patches);
}

export function hasResolvableImportedPerformance(
  config: SequencerConfigSnapshot,
  patches: PatchListItem[]
): boolean {
  const knownPatchIds = new Set(patches.map((patch) => patch.id));
  return config.instruments.some((instrument) => knownPatchIds.has(instrument.patchId));
}

export function resolvePerformanceImportOperation(
  exported: PerformanceExportPayload,
  performances: PerformanceListItem[],
  performanceConflict: ImportConflictDialogItem | null,
  config: SequencerConfigSnapshot
): PerformanceImportOperation {
  const incomingName = exportedPerformanceName(exported);
  const existingPerformance = findPerformanceByName(performances, incomingName);
  const payload: PerformanceWritePayload = {
    name: incomingName,
    description: exported.performance.description,
    config
  };

  if (existingPerformance && (!performanceConflict || performanceConflict.overwrite)) {
    return {
      type: "update",
      performanceId: existingPerformance.id,
      payload
    };
  }

  if (existingPerformance && performanceConflict) {
    return {
      type: "create",
      payload: {
        ...payload,
        name: performanceConflict.targetName.trim()
      }
    };
  }

  return {
    type: "create",
    payload
  };
}
