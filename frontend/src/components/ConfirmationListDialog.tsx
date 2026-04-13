import type { JSX } from "react";

import { ModalFrame } from "./ModalFrame";

type ConfirmationListDialogProps = {
  ariaLabel: string;
  title: string;
  description: string;
  items: string[];
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  maxWidthClassName?: string;
  confirmTone?: "accent" | "danger";
};

export function ConfirmationListDialog({
  ariaLabel,
  title,
  description,
  items,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  maxWidthClassName = "max-w-2xl",
  confirmTone = "danger"
}: ConfirmationListDialogProps): JSX.Element {
  const confirmClassName =
    confirmTone === "danger"
      ? "rounded-md border border-rose-500/70 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-rose-200 transition hover:bg-rose-500/25"
      : "rounded-md border border-cyan-500/70 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200 transition hover:bg-cyan-500/25";

  return (
    <ModalFrame
      ariaLabel={ariaLabel}
      title={title}
      subtitle={description}
      onClose={onCancel}
      bodyClassName="min-h-0 overflow-y-auto px-4 py-4"
      maxWidthClassName={maxWidthClassName}
    >
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li
            key={`${index}:${item}`}
            className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 font-mono text-xs text-slate-200"
          >
            {item}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-700 pt-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-200 transition hover:border-slate-400"
        >
          {cancelLabel}
        </button>
        <button type="button" onClick={onConfirm} className={confirmClassName}>
          {confirmLabel}
        </button>
      </div>
    </ModalFrame>
  );
}
