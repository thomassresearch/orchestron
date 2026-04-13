import type { Dispatch, JSX, SetStateAction } from "react";

import type {
  ImportConflictDialogItem,
  ImportConflictDialogState,
  ImportDialogCopy,
  ImportSelectionDialogState
} from "../lib/importDialogs";

interface ImportDialogsProps {
  importDialogCopy: ImportDialogCopy;
  importSelectionDialog: ImportSelectionDialogState | null;
  setImportSelectionDialog: Dispatch<SetStateAction<ImportSelectionDialogState | null>>;
  closeImportSelectionDialog: (confirmed: boolean) => void;
  importConflictDialog: ImportConflictDialogState | null;
  setImportConflictDialog: Dispatch<SetStateAction<ImportConflictDialogState | null>>;
  closeImportConflictDialog: (confirmed: boolean) => void;
  importConflictValidationError: string | null;
}

function updateImportConflictItem(
  items: ImportConflictDialogItem[],
  itemId: string,
  updater: (item: ImportConflictDialogItem) => ImportConflictDialogItem
): ImportConflictDialogItem[] {
  return items.map((item) => (item.id === itemId ? updater(item) : item));
}

export function ImportDialogs({
  importDialogCopy,
  importSelectionDialog,
  setImportSelectionDialog,
  closeImportSelectionDialog,
  importConflictDialog,
  setImportConflictDialog,
  closeImportConflictDialog,
  importConflictValidationError
}: ImportDialogsProps): JSX.Element {
  return (
    <>
      {importSelectionDialog && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/75 p-4"
          onMouseDown={() => closeImportSelectionDialog(false)}
        >
          <section
            className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={importDialogCopy.optionsTitle}
          >
            <header className="border-b border-slate-700 px-4 py-3">
              <h2 className="font-display text-lg font-semibold text-slate-100">{importDialogCopy.optionsTitle}</h2>
              <p className="mt-1 text-xs text-slate-400">{importDialogCopy.optionsDescription}</p>
            </header>

            <div className="space-y-3 px-4 py-4 text-sm text-slate-200">
              <label className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
                <input
                  type="checkbox"
                  checked={importSelectionDialog.importPerformance}
                  onChange={(event) =>
                    setImportSelectionDialog((state) =>
                      state
                        ? {
                            ...state,
                            importPerformance: event.target.checked
                          }
                        : state
                    )
                  }
                  className="h-4 w-4 accent-cyan-400"
                />
                <span>{importDialogCopy.performanceLabel}</span>
              </label>

              <label
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                  importSelectionDialog.patchDefinitionsAvailable
                    ? "border-slate-700 bg-slate-950/70"
                    : "border-slate-800 bg-slate-900/50 text-slate-500"
                }`}
              >
                <input
                  type="checkbox"
                  checked={importSelectionDialog.importPatchDefinitions}
                  disabled={!importSelectionDialog.patchDefinitionsAvailable}
                  onChange={(event) =>
                    setImportSelectionDialog((state) =>
                      state
                        ? {
                            ...state,
                            importPatchDefinitions: event.target.checked
                          }
                        : state
                    )
                  }
                  className="h-4 w-4 accent-cyan-400 disabled:opacity-50"
                />
                <span>{importDialogCopy.patchDefinitionsLabel}</span>
              </label>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-slate-700 px-4 py-3">
              <button
                type="button"
                onClick={() => closeImportSelectionDialog(false)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-200 transition hover:border-slate-400"
              >
                {importDialogCopy.cancel}
              </button>
              <button
                type="button"
                disabled={!importSelectionDialog.importPerformance && !importSelectionDialog.importPatchDefinitions}
                onClick={() => closeImportSelectionDialog(true)}
                className="rounded-md border border-cyan-500/70 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importDialogCopy.import}
              </button>
            </footer>
          </section>
        </div>
      )}

      {importConflictDialog && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/75 p-4"
          onMouseDown={() => closeImportConflictDialog(false)}
        >
          <section
            className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={importDialogCopy.conflictsTitle}
          >
            <header className="border-b border-slate-700 px-4 py-3">
              <h2 className="font-display text-lg font-semibold text-slate-100">{importDialogCopy.conflictsTitle}</h2>
              <p className="mt-1 text-xs text-slate-400">{importDialogCopy.conflictsDescription}</p>
            </header>

            <div className="min-h-0 space-y-2 overflow-y-auto px-4 py-4">
              {importConflictDialog.items.map((item) => (
                <article key={item.id} className="rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-sm font-semibold text-slate-100">
                      {item.kind === "patch"
                        ? importDialogCopy.conflictPatchLabel(item.originalName)
                        : importDialogCopy.conflictPerformanceLabel(item.originalName)}
                    </div>
                    <label className="ml-auto inline-flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-slate-300">
                      <input
                        type="checkbox"
                        checked={item.overwrite}
                        disabled={item.kind === "patch" && item.skip}
                        onChange={(event) =>
                          setImportConflictDialog((state) =>
                            state
                              ? {
                                  items: updateImportConflictItem(state.items, item.id, (entry) => ({
                                    ...entry,
                                    overwrite: event.target.checked
                                  }))
                                }
                              : state
                          )
                        }
                        className="h-4 w-4 accent-cyan-400 disabled:opacity-50"
                      />
                      <span>{importDialogCopy.overwriteLabel}</span>
                    </label>
                    {item.kind === "patch" && (
                      <label className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-slate-300">
                        <input
                          type="checkbox"
                          checked={item.skip}
                          onChange={(event) =>
                            setImportConflictDialog((state) =>
                              state
                                ? {
                                    items: updateImportConflictItem(state.items, item.id, (entry) => ({
                                      ...entry,
                                      skip: event.target.checked
                                    }))
                                  }
                                : state
                            )
                          }
                          className="h-4 w-4 accent-cyan-400"
                        />
                        <span>{importDialogCopy.skipLabel}</span>
                      </label>
                    )}
                  </div>

                  {!item.overwrite && !(item.kind === "patch" && item.skip) && (
                    <label className="mt-2 flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        {importDialogCopy.newNameLabel}
                      </span>
                      <input
                        value={item.targetName}
                        onChange={(event) =>
                          setImportConflictDialog((state) =>
                            state
                              ? {
                                  items: updateImportConflictItem(state.items, item.id, (entry) => ({
                                    ...entry,
                                    targetName: event.target.value
                                  }))
                                }
                              : state
                          )
                        }
                        className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-cyan-400/40 transition focus:ring"
                      />
                    </label>
                  )}
                </article>
              ))}
            </div>

            <footer className="border-t border-slate-700 px-4 py-3">
              {importConflictValidationError && (
                <div className="mb-2 rounded-md border border-rose-500/60 bg-rose-950/50 px-2 py-1.5 text-xs text-rose-200">
                  {importConflictValidationError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => closeImportConflictDialog(false)}
                  className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-200 transition hover:border-slate-400"
                >
                  {importDialogCopy.cancel}
                </button>
                <button
                  type="button"
                  disabled={importConflictValidationError !== null}
                  onClick={() => closeImportConflictDialog(true)}
                  className="rounded-md border border-cyan-500/70 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importDialogCopy.import}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
