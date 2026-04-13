import type { PatchListItem, PerformanceListItem } from "../types";

import { normalizeNameKey } from "./patchCatalog";

export interface ImportSelectionDialogState {
  patchDefinitionsAvailable: boolean;
  importPerformance: boolean;
  importPatchDefinitions: boolean;
}

export interface ImportSelectionDialogResult {
  confirmed: boolean;
  importPerformance: boolean;
  importPatchDefinitions: boolean;
}

export interface ImportConflictDialogItem {
  id: string;
  kind: "patch" | "performance";
  sourcePatchId?: string;
  originalName: string;
  overwrite: boolean;
  targetName: string;
  skip: boolean;
}

export interface ImportConflictDialogState {
  items: ImportConflictDialogItem[];
}

export interface ImportConflictDialogResult {
  confirmed: boolean;
  items: ImportConflictDialogItem[];
}

export interface ImportDialogCopy {
  optionsTitle: string;
  optionsDescription: string;
  performanceLabel: string;
  patchDefinitionsLabel: string;
  conflictsTitle: string;
  conflictsDescription: string;
  overwriteLabel: string;
  skipLabel: string;
  newNameLabel: string;
  cancel: string;
  import: string;
  conflictPatchLabel: (name: string) => string;
  conflictPerformanceLabel: (name: string) => string;
  validation: {
    nameRequired: (kindLabel: string, originalName: string) => string;
    patchNameExists: (name: string) => string;
    patchNameDuplicate: (name: string) => string;
    performanceNameExists: (name: string) => string;
    performanceNameDuplicate: (name: string) => string;
  };
}

export function validateImportConflictItems(
  items: ImportConflictDialogItem[],
  patches: PatchListItem[],
  performances: PerformanceListItem[],
  copy: ImportDialogCopy
): string | null {
  const existingPatchNames = new Set(patches.map((patch) => normalizeNameKey(patch.name)));
  const existingPerformanceNames = new Set(performances.map((performance) => normalizeNameKey(performance.name)));
  const plannedPatchNames = new Set<string>();
  const plannedPerformanceNames = new Set<string>();

  for (const item of items) {
    if (item.kind === "patch" && item.skip) {
      continue;
    }
    if (item.overwrite) {
      continue;
    }

    const nextName = item.targetName.trim();
    if (nextName.length === 0) {
      return copy.validation.nameRequired(
        item.kind === "patch" ? copy.patchDefinitionsLabel : copy.performanceLabel,
        item.originalName
      );
    }

    const key = normalizeNameKey(nextName);
    if (item.kind === "patch") {
      if (existingPatchNames.has(key)) {
        return copy.validation.patchNameExists(nextName);
      }
      if (plannedPatchNames.has(key)) {
        return copy.validation.patchNameDuplicate(nextName);
      }
      plannedPatchNames.add(key);
      continue;
    }

    if (existingPerformanceNames.has(key)) {
      return copy.validation.performanceNameExists(nextName);
    }
    if (plannedPerformanceNames.has(key)) {
      return copy.validation.performanceNameDuplicate(nextName);
    }
    plannedPerformanceNames.add(key);
  }

  return null;
}
