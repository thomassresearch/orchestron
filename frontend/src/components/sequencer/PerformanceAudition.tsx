import { createContext, useContext } from "react";
import type { GuiLanguage, PadLoopPatternItem } from "../../types";
import { arrangementCopy } from "../../lib/arrangementCopy";
import { useAppStore } from "../../store/useAppStore";

export type PreviewCommand = { action: "preview_arm" | "preview_start" | "preview_end"; gestureId: string; item?: PadLoopPatternItem };
export type WorkspaceCommand = { action: "workspace_start" | "workspace_end"; gestureId: string; items?: PadLoopPatternItem[] };
export type AuditionDevice = (id: string, itemOrAction: PadLoopPatternItem | "cancel" | "stop" | "return" | PreviewCommand | WorkspaceCommand) => Promise<void>;
export const PerformanceAuditionContext = createContext<AuditionDevice | null>(null);
export const usePerformanceAudition = () => useContext(PerformanceAuditionContext);

export function PerformanceAuditionControls({ id, language, item, manualLaunch, editingPad, playingPad, queuedPad, playing = false, compact = false }: {
  id: string; language: GuiLanguage; item?: PadLoopPatternItem; manualLaunch?: () => void;
  editingPad?: number; playingPad?: number; queuedPad?: number | null; playing?: boolean;
  compact?: boolean;
}) {
  const audition = usePerformanceAudition();
  const status = useAppStore(state => state.performanceAuditions[id]);
  const c = arrangementCopy(language);
  const button = "rounded border border-slate-600 px-2 py-1 text-xs hover:border-cyan-300 disabled:opacity-40";
  return <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
    {editingPad !== undefined && <span>{c.editing}: #{editingPad + 1}</span>}
    {playing && playingPad !== undefined && <span className="text-emerald-300">{c.playing}: #{playingPad + 1}</span>}
    {queuedPad != null && <span className="text-amber-200">{c.queued}: #{queuedPad + 1}</span>}
    {manualLaunch ? <button className={button} onClick={manualLaunch}>{c.launch}</button> : !compact && item && audition &&
      <button className={button} onClick={() => void audition(id, item)}>{c.audition}</button>}
    {!compact && status?.active && <span className="text-cyan-300">{c.auditioning}</span>}
    {!compact && status?.queued && <><span className="text-amber-200">{c.queued}: {status.queued === "return" ? c.return : c.audition}</span><button className={button} onClick={() => void audition?.(id, "cancel")}>{c.cancel}</button></>}
    {!compact && status && <><button className={button} onClick={() => void audition?.(id, "return")}>{c.return}</button><button className={button} onClick={() => void audition?.(id, "stop")}>{c.stopAudition}</button></>}
  </div>;
}
