import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ImportConflictDialogItem,
  ImportConflictDialogResult,
  ImportConflictDialogState,
  ImportSelectionDialogResult,
  ImportSelectionDialogState
} from "../lib/importDialogs";

interface UseImportDialogsResult {
  importSelectionDialog: ImportSelectionDialogState | null;
  importConflictDialog: ImportConflictDialogState | null;
  requestImportSelectionDialog: (patchDefinitionsAvailable: boolean) => Promise<ImportSelectionDialogResult>;
  closeImportSelectionDialog: (confirmed: boolean) => void;
  requestImportConflictDialog: (items: ImportConflictDialogItem[]) => Promise<ImportConflictDialogResult>;
  closeImportConflictDialog: (confirmed: boolean) => void;
  setImportSelectionOption: (key: "importPerformance" | "importPatchDefinitions", value: boolean) => void;
  setImportConflictOverwrite: (itemId: string, overwrite: boolean) => void;
  setImportConflictSkip: (itemId: string, skip: boolean) => void;
  setImportConflictTargetName: (itemId: string, targetName: string) => void;
}

function updateImportConflictItems(
  items: ImportConflictDialogItem[],
  itemId: string,
  updater: (item: ImportConflictDialogItem) => ImportConflictDialogItem
): ImportConflictDialogItem[] {
  return items.map((item) => (item.id === itemId ? updater(item) : item));
}

export function useImportDialogs(): UseImportDialogsResult {
  const importSelectionDialogResolverRef = useRef<((result: ImportSelectionDialogResult) => void) | null>(null);
  const importConflictDialogResolverRef = useRef<((result: ImportConflictDialogResult) => void) | null>(null);
  const [importSelectionDialog, setImportSelectionDialog] = useState<ImportSelectionDialogState | null>(null);
  const [importConflictDialog, setImportConflictDialog] = useState<ImportConflictDialogState | null>(null);

  const requestImportSelectionDialog = useCallback((patchDefinitionsAvailable: boolean) => {
    return new Promise<ImportSelectionDialogResult>((resolve) => {
      importSelectionDialogResolverRef.current = resolve;
      setImportSelectionDialog({
        patchDefinitionsAvailable,
        importPerformance: true,
        importPatchDefinitions: patchDefinitionsAvailable
      });
    });
  }, []);

  const closeImportSelectionDialog = useCallback(
    (confirmed: boolean) => {
      const resolver = importSelectionDialogResolverRef.current;
      const snapshot = importSelectionDialog;
      importSelectionDialogResolverRef.current = null;
      setImportSelectionDialog(null);
      if (!resolver) {
        return;
      }

      if (!confirmed || !snapshot) {
        resolver({
          confirmed: false,
          importPerformance: false,
          importPatchDefinitions: false
        });
        return;
      }

      resolver({
        confirmed: true,
        importPerformance: snapshot.importPerformance,
        importPatchDefinitions: snapshot.patchDefinitionsAvailable ? snapshot.importPatchDefinitions : false
      });
    },
    [importSelectionDialog]
  );

  const requestImportConflictDialog = useCallback((items: ImportConflictDialogItem[]) => {
    return new Promise<ImportConflictDialogResult>((resolve) => {
      importConflictDialogResolverRef.current = resolve;
      setImportConflictDialog({ items });
    });
  }, []);

  const setImportSelectionOption = useCallback(
    (key: "importPerformance" | "importPatchDefinitions", value: boolean) => {
      setImportSelectionDialog((state) => (state ? { ...state, [key]: value } : state));
    },
    []
  );

  const setImportConflictOverwrite = useCallback((itemId: string, overwrite: boolean) => {
    setImportConflictDialog((state) =>
      state
        ? {
            items: updateImportConflictItems(state.items, itemId, (item) => ({
              ...item,
              overwrite
            }))
          }
        : state
    );
  }, []);

  const setImportConflictSkip = useCallback((itemId: string, skip: boolean) => {
    setImportConflictDialog((state) =>
      state
        ? {
            items: updateImportConflictItems(state.items, itemId, (item) => ({
              ...item,
              skip
            }))
          }
        : state
    );
  }, []);

  const setImportConflictTargetName = useCallback((itemId: string, targetName: string) => {
    setImportConflictDialog((state) =>
      state
        ? {
            items: updateImportConflictItems(state.items, itemId, (item) => ({
              ...item,
              targetName
            }))
          }
        : state
    );
  }, []);

  const closeImportConflictDialog = useCallback(
    (confirmed: boolean) => {
      const resolver = importConflictDialogResolverRef.current;
      const snapshot = importConflictDialog;
      importConflictDialogResolverRef.current = null;
      setImportConflictDialog(null);
      if (!resolver) {
        return;
      }

      resolver({
        confirmed,
        items: snapshot?.items ?? []
      });
    },
    [importConflictDialog]
  );

  useEffect(() => {
    return () => {
      const selectionResolver = importSelectionDialogResolverRef.current;
      if (selectionResolver) {
        importSelectionDialogResolverRef.current = null;
        selectionResolver({
          confirmed: false,
          importPerformance: false,
          importPatchDefinitions: false
        });
      }

      const conflictResolver = importConflictDialogResolverRef.current;
      if (conflictResolver) {
        importConflictDialogResolverRef.current = null;
        conflictResolver({
          confirmed: false,
          items: []
        });
      }
    };
  }, []);

  return {
    importSelectionDialog,
    importConflictDialog,
    requestImportSelectionDialog,
    closeImportSelectionDialog,
    requestImportConflictDialog,
    closeImportConflictDialog,
    setImportSelectionOption,
    setImportConflictOverwrite,
    setImportConflictSkip,
    setImportConflictTargetName
  };
}
