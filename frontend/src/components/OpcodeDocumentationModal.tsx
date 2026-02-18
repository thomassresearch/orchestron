import { useEffect } from "react";

import type { OpcodeSpec } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface OpcodeDocumentationModalProps {
  opcode: OpcodeSpec;
  onClose: () => void;
}

export function OpcodeDocumentationModal({ opcode, onClose }: OpcodeDocumentationModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/70 p-4" onMouseDown={onClose}>
      <section
        className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${opcode.name} documentation`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-700 px-4 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">{opcode.name}</h2>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Opcode Documentation</p>
          </div>
          <div className="flex items-center gap-2">
            {opcode.documentation_url && (
              <a
                href={opcode.documentation_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300 transition hover:bg-cyan-500/20"
              >
                Open Csound Reference
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400"
            >
              Close
            </button>
          </div>
        </header>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {opcode.documentation_markdown.trim().length > 0 ? (
            <MarkdownRenderer markdown={opcode.documentation_markdown} />
          ) : (
            <p className="text-sm text-slate-300">No documentation markdown available for this opcode.</p>
          )}
        </div>
      </section>
    </div>
  );
}
