const base = "rounded-md border px-2 py-1 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-50";

// Keep action colors aligned with the rack, sequencers and patch toolbar.
export const clipButtonTone = {
  neutral: "border-slate-600 bg-slate-900 text-slate-200 enabled:hover:border-slate-400 enabled:hover:bg-slate-800",
  add: "border-emerald-400/55 bg-emerald-400/20 text-emerald-300 enabled:hover:bg-emerald-400/30",
  remove: "border-rose-500/60 bg-rose-500/15 text-rose-200 enabled:hover:bg-rose-500/25",
  edit: "border-amber-400/55 bg-amber-400/20 text-amber-200 enabled:hover:bg-amber-400/30",
  save: "border-mint/50 bg-mint/15 text-mint enabled:hover:bg-mint/25"
};

export const clipButtonClass = (tone: keyof typeof clipButtonTone) => `${base} ${clipButtonTone[tone]}`;
export const clipButton = clipButtonClass("neutral");
