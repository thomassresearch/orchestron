import { useEffect } from "react";
import type { JSX, ReactNode } from "react";

type ModalFrameProps = {
  ariaLabel: string;
  title: string;
  subtitle?: ReactNode;
  closeLabel?: string;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  bodyClassName?: string;
  footerClassName?: string;
  headerClassName?: string;
  maxHeightClassName?: string;
  maxWidthClassName?: string;
  overlayClassName?: string;
  subtitleClassName?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
};

export function ModalFrame({
  ariaLabel,
  title,
  subtitle,
  closeLabel,
  onClose,
  actions,
  children,
  footer,
  bodyClassName = "min-h-0 overflow-y-auto px-4 py-4",
  footerClassName = "flex items-center justify-end gap-2 border-t border-slate-700 px-4 py-3",
  headerClassName = "flex items-start justify-between gap-3 border-b border-slate-700 px-4 py-3",
  maxHeightClassName = "max-h-[86vh]",
  maxWidthClassName = "max-w-2xl",
  overlayClassName = "fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/75 p-4",
  subtitleClassName = "mt-1 text-xs text-slate-400",
  closeOnBackdrop = true,
  closeOnEscape = false
}: ModalFrameProps): JSX.Element {
  useEffect(() => {
    if (!closeOnEscape) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeOnEscape, onClose]);

  return (
    <div className={overlayClassName} onMouseDown={closeOnBackdrop ? onClose : undefined}>
      <section
        className={`flex ${maxHeightClassName} w-full ${maxWidthClassName} flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        <header className={headerClassName}>
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">{title}</h2>
            {subtitle ? <div className={subtitleClassName}>{subtitle}</div> : null}
          </div>
          {actions || closeLabel ? (
            <div className="flex items-center gap-2">
              {actions}
              {closeLabel ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400"
                >
                  {closeLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </header>

        <div className={bodyClassName}>{children}</div>

        {footer ? <footer className={footerClassName}>{footer}</footer> : null}
      </section>
    </div>
  );
}
