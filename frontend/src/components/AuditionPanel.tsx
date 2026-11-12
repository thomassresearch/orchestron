import type { ReactNode } from "react";
import { useAppStore } from "../store/useAppStore";
import { useInstrumentAudition } from "../hooks/useInstrumentAudition";
import { auditionCopy } from "../lib/auditionCopy";
import { defaultAuditionNote } from "../lib/controlFlow";
import { AuditionControl } from "./audition/AuditionControl";
import { AuditionKeyboard } from "./audition/AuditionKeyboard";

export function AuditionPanel({ stopPerformance, children }: { stopPerformance: () => Promise<void>; children?: ReactNode }) {
  const draft = useAppStore(s => s.currentPatch);
  const language = useAppStore(s => s.guiLanguage);
  const copy = auditionCopy(language);
  const audition = useInstrumentAudition(draft, stopPerformance, copy);
  const running = audition.phase === "running";
  return <div className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" aria-pressed={running} disabled={audition.phase === "stopping"} onClick={audition.toggle}
        className={`rounded border px-3 py-1 text-xs focus-visible:outline-cyan-300 disabled:opacity-50 ${running ? "border-cyan-300 bg-cyan-800 text-white" : "border-cyan-500/60 bg-cyan-950 text-cyan-100"}`}>
        {audition.phase === "preparing" ? copy.preparing : audition.phase === "stopping" ? copy.stopping : running ? copy.stop : copy.start}
      </button>
      {children}
    </div>
    {running && audition.snapshot && <div className="mt-2 flex min-w-0 flex-col gap-2 border-t border-slate-700/60 pt-2">
      {audition.snapshot.definitions.length > 0 && <div role="group" aria-label={copy.controls} className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
        {audition.snapshot.definitions.map(d => <AuditionControl key={d.node_id} definition={d}
          value={audition.values[d.node_id] ?? d.default} alwaysOn={audition.snapshot!.alwaysOn} language={language}
          onChange={value => audition.changeValue(d, value)} />)}
      </div>}
      <AuditionKeyboard initialNote={defaultAuditionNote(draft.graph)} disabled={!audition.snapshot.midi.length} language={language} pressNote={audition.pressNote} />
      {audition.stale && <p role="status" className="text-xs text-amber-200">{copy.stale}</p>}
    </div>}
    {audition.error && <p role="alert" className="mt-2 text-xs text-rose-300">{audition.error}</p>}
  </div>;
}
