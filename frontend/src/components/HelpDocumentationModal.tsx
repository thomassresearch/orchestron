import { useEffect } from "react";

import type { GuiLanguage } from "../types";

import { documentationUiCopy } from "../lib/documentation";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface HelpDocumentationModalProps {
  title: string;
  markdown: string;
  guiLanguage: GuiLanguage;
  onClose: () => void;
}

export function HelpDocumentationModal({ title, markdown, guiLanguage, onClose }: HelpDocumentationModalProps) {
  const ui = documentationUiCopy(guiLanguage);

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
        aria-label={ui.help}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-700 px-4 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">{title}</h2>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">{ui.help}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400"
          >
            {ui.close}
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <MarkdownRenderer markdown={markdown} />
        </div>
      </section>
    </div>
  );
}
