import type { JSX, ReactNode } from "react";

import { ModalFrame } from "./ModalFrame";

interface DocumentationModalFrameProps {
  ariaLabel: string;
  title: string;
  subtitle: string;
  closeLabel: string;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export function DocumentationModalFrame({
  ariaLabel,
  title,
  subtitle,
  closeLabel,
  onClose,
  actions,
  children
}: DocumentationModalFrameProps): JSX.Element {
  return (
    <ModalFrame
      ariaLabel={ariaLabel}
      title={title}
      subtitle={<span className="text-xs uppercase tracking-[0.16em] text-slate-400">{subtitle}</span>}
      closeLabel={closeLabel}
      onClose={onClose}
      actions={actions}
      bodyClassName="min-h-0 overflow-y-auto px-5 py-4"
      maxWidthClassName="max-w-3xl"
      overlayClassName="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/70 p-4"
      subtitleClassName=""
      closeOnEscape
    >
      {children}
    </ModalFrame>
  );
}
