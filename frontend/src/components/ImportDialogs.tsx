import type { JSX } from "react";

import type {
  ImportConflictDialogState,
  ImportDialogCopy,
  ImportSelectionDialogState
} from "../lib/importDialogs";
import { ModalFrame } from "./ModalFrame";

interface ImportDialogsProps {
  importDialogCopy: ImportDialogCopy;
  importSelectionDialog: ImportSelectionDialogState | null;
  setImportSelectionOption: (key: "importPerformance" | "importPatchDefinitions", value: boolean) => void;
  closeImportSelectionDialog: (confirmed: boolean) => void;
  importConflictDialog: ImportConflictDialogState | null;
  setImportConflictOverwrite: (itemId: string, overwrite: boolean) => void;
  setImportConflictSkip: (itemId: string, skip: boolean) => void;
  setImportConflictTargetName: (itemId: string, targetName: string) => void;
  closeImportConflictDialog: (confirmed: boolean) => void;
  importConflictValidationError: string | null;
}

export function ImportDialogs({
  importDialogCopy,
  importSelectionDialog,
  setImportSelectionOption,
  closeImportSelectionDialog,
  importConflictDialog,
  setImportConflictOverwrite,
  setImportConflictSkip,
  setImportConflictTargetName,
  closeImportConflictDialog,
  importConflictValidationError
}: ImportDialogsProps): JSX.Element {
  const selectionFooter = importSelectionDialog ? (
    <>
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
    </>
  ) : null;

  const conflictFooter = importConflictDialog ? (
    <>
      {importConflictValidationError ? (
        <div className="mr-auto rounded-md border border-rose-500/60 bg-rose-950/50 px-2 py-1.5 text-xs text-rose-200">
          {importConflictValidationError}
        </div>
      ) : null}
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
    </>
  ) : null;

  return (
    <>
      {importSelectionDialog && (
        <ModalFrame
          ariaLabel={importDialogCopy.optionsTitle}
          title={importDialogCopy.optionsTitle}
          subtitle={importDialogCopy.optionsDescription}
          onClose={() => closeImportSelectionDialog(false)}
          footer={selectionFooter}
          maxWidthClassName="max-w-xl"
          bodyClassName="space-y-3 px-4 py-4 text-sm text-slate-200"
        >
          <label className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
            <input
              type="checkbox"
              checked={importSelectionDialog.importPerformance}
              onChange={(event) => setImportSelectionOption("importPerformance", event.target.checked)}
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
              onChange={(event) => setImportSelectionOption("importPatchDefinitions", event.target.checked)}
              className="h-4 w-4 accent-cyan-400 disabled:opacity-50"
            />
            <span>{importDialogCopy.patchDefinitionsLabel}</span>
          </label>
        </ModalFrame>
      )}

      {importConflictDialog && (
        <ModalFrame
          ariaLabel={importDialogCopy.conflictsTitle}
          title={importDialogCopy.conflictsTitle}
          subtitle={importDialogCopy.conflictsDescription}
          onClose={() => closeImportConflictDialog(false)}
          footer={conflictFooter}
          maxWidthClassName="max-w-2xl"
          bodyClassName="min-h-0 space-y-2 overflow-y-auto px-4 py-4"
        >
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
                    onChange={(event) => setImportConflictOverwrite(item.id, event.target.checked)}
                    className="h-4 w-4 accent-cyan-400 disabled:opacity-50"
                  />
                  <span>{importDialogCopy.overwriteLabel}</span>
                </label>
                {item.kind === "patch" ? (
                  <label className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-slate-300">
                    <input
                      type="checkbox"
                      checked={item.skip}
                      onChange={(event) => setImportConflictSkip(item.id, event.target.checked)}
                      className="h-4 w-4 accent-cyan-400"
                    />
                    <span>{importDialogCopy.skipLabel}</span>
                  </label>
                ) : null}
              </div>

              {!item.overwrite && !(item.kind === "patch" && item.skip) ? (
                <label className="mt-2 flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                    {importDialogCopy.newNameLabel}
                  </span>
                  <input
                    value={item.targetName}
                    onChange={(event) => setImportConflictTargetName(item.id, event.target.value)}
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-cyan-400/40 transition focus:ring"
                  />
                </label>
              ) : null}
            </article>
          ))}
        </ModalFrame>
      )}
    </>
  );
}
