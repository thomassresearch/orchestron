import type { JSX, ReactNode } from "react";

import { ModalFrame } from "./ModalFrame";

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
  return (
    <ModalFrame
      ariaLabel={ariaLabel}
      title={title}
      subtitle={
        <span className="text-xs uppercase tracking-[0.16em] text-slate-400">
          {nodeLabel} {nodeId}
        </span>
      }
      closeLabel={closeLabel}
      onClose={onClose}
      bodyClassName={bodyClassName}
      maxHeightClassName={maxHeightClassName}
      maxWidthClassName={maxWidthClassName}
      overlayClassName="fixed inset-0 z-[1260] flex items-center justify-center bg-slate-950/80 p-4"
      subtitleClassName=""
      footer={footer}
    >
      {children}
    </ModalFrame>
  );
}
