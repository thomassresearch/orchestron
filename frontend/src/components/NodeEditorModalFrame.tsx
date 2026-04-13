import type { JSX, ReactNode } from "react";

type NodeEditorModalFrameProps = {
  ariaLabel: string;
  title: string;
  nodeId: string;
  nodeLabel: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  bodyClassName?: string;
  maxHeightClassName?: string;
  maxWidthClassName?: string;
};

export function NodeEditorModalFrame({
  ariaLabel,
  title,
  nodeId,
  nodeLabel,
  closeLabel,
  onClose,
  children,
  footer,
  bodyClassName = "overflow-y-auto p-4",
  maxHeightClassName = "max-h-[90vh]",
  maxWidthClassName = "max-w-2xl"
}: NodeEditorModalFrameProps): JSX.Element {
  const panelClassName = [
    "flex",
    maxHeightClassName,
    "w-full",
    maxWidthClassName,
    "flex-col",
    "overflow-hidden",
    "rounded-2xl",
    "border",
    "border-slate-700",
    "bg-slate-900",
    "shadow-2xl"
  ].join(" ");

  return (
    <div className="fixed inset-0 z-[1260] flex items-center justify-center bg-slate-950/80 p-4" onMouseDown={onClose}>
      <section
        className={panelClassName}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-700 px-4 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">{title}</h2>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
              {nodeLabel} {nodeId}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400"
          >
            {closeLabel}
          </button>
        </header>

        <div className={bodyClassName}>{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-slate-700 px-4 py-3">{footer}</footer>
        ) : null}
      </section>
    </div>
  );
}
