import { arrangementCopy } from "../../lib/arrangementCopy";
import type { GuiLanguage } from "../../types";

export function followPlayheadOffset(playhead: number, songEnd: number, trackWidth: number) {
  // Leave the one-pixel end marker inside the visible track area.
  return Math.max(0, Math.min(playhead - trackWidth / 2, songEnd + 1 - trackWidth));
}

export function ArrangerFollowPlayhead({ language, checked, onChange }: {
  language: GuiLanguage;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return <label className="flex items-center gap-1.5 text-xs text-slate-300">
    <input type="checkbox" className="accent-cyan-400" checked={checked} onChange={event => onChange(event.target.checked)} />
    {arrangementCopy(language).followPlayhead}
  </label>;
}
