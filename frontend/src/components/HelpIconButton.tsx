import type { GuiLanguage } from "../types";

import { documentationUiCopy } from "../lib/documentation";

interface HelpIconButtonProps {
  guiLanguage: GuiLanguage;
  onClick: () => void;
  className?: string;
}

export function HelpIconButton({ guiLanguage, onClick, className }: HelpIconButtonProps) {
  const ui = documentationUiCopy(guiLanguage);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ui.showDocumentation}
      title={ui.showDocumentation}
      className={
        className ??
        "absolute right-2 top-2 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-500 bg-slate-950/90 text-xs font-bold text-slate-100 transition hover:border-accent hover:text-accent"
      }
    >
      ?
    </button>
  );
}
