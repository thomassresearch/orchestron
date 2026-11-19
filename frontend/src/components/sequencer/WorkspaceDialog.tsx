import { useLayoutEffect, useRef, type ReactNode } from "react";

export function WorkspaceDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element.close(); trigger?.focus(); };
  }, []);
  return <dialog ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}
    className="max-h-[85dvh] w-[min(25rem,94vw)] overflow-auto rounded-xl border border-slate-600 bg-slate-950 p-4 text-sm text-slate-100 shadow-xl backdrop:bg-black/60">
    <h3 className="mb-3 font-semibold text-cyan-100">{title}</h3>{children}
  </dialog>;
}
