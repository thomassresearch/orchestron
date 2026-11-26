import type { GuiLanguage } from "../types";

import { documentationUiCopy } from "../lib/documentationUi";

interface HelpIconButtonProps {
  guiLanguage: GuiLanguage;
  onClick: () => void;
  topic?: string;
  className?: string;
}

export function HelpIconButton({ guiLanguage, onClick, className, topic }: HelpIconButtonProps) {
  const ui = documentationUiCopy(guiLanguage);
  const label = topic ? `${ui.help} · ${topic}` : ui.showDocumentation;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        className ??
        "absolute right-2 top-2 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-500 bg-slate-950/90 text-xs font-bold text-slate-100 transition hover:border-accent hover:text-accent"
      }
    >
      ?
    </button>
  );
}
