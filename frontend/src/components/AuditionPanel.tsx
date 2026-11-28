import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../store/useAppStore";
import { useInstrumentAudition } from "../hooks/useInstrumentAudition";
import { sampleCopy } from "../lib/sampleCopy";
import { auditionCopy } from "../lib/auditionCopy";
import { defaultAuditionNote } from "../lib/controlFlow";
import { AuditionControl } from "./audition/AuditionControl";
import { AuditionPlayer } from "./audition/AuditionPlayer";

const KeyboardHost = createContext<{
  controls: HTMLDivElement | null; setControls: (element: HTMLDivElement | null) => void;
  host: HTMLDivElement | null; setHost: (element: HTMLDivElement | null) => void;
} | null>(null);

export function AuditionKeyboardProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  return <KeyboardHost.Provider value={{ host, setHost, controls, setControls }}>{children}</KeyboardHost.Provider>;
}

export function InstrumentAuditionKeyboard({ withControls = false }: { withControls?: boolean }) {
  const target = useContext(KeyboardHost);
  return target && <>{withControls && <div ref={target.setControls} className="empty:hidden" />}
    <div ref={target.setHost} className="empty:hidden" /></>;
}

export function AuditionPanel({ stopPerformance, children }: { stopPerformance: () => Promise<void>; children?: ReactNode }) {
  const draft = useAppStore(s => s.currentPatch);
  const language = useAppStore(s => s.guiLanguage);
  const copy = auditionCopy(language);
  const audition = useInstrumentAudition(draft, stopPerformance, copy);
  const editorHosts = useContext(KeyboardHost);
  const keyboardHost = editorHosts?.host;
  const running = audition.phase === "running";
  const emptySampler = draft.graph.nodes.some(node => node.opcode === "sample_player");
  const toggle = <button type="button" aria-pressed={running} disabled={(emptySampler && audition.phase === "off") || audition.phase === "stopping"} onClick={audition.toggle}
        className={`rounded border px-3 py-1 text-xs focus-visible:outline-cyan-300 disabled:opacity-50 ${running ? "border-cyan-300 bg-cyan-800 text-white" : "border-cyan-500/60 bg-cyan-950 text-cyan-100"}`}>
        {audition.phase === "preparing" ? copy.preparing : audition.phase === "stopping" ? copy.stopping : running ? copy.stop : copy.start}
      </button>;
  const error = audition.error && <p role="alert" className="mt-2 text-xs text-rose-300">{audition.error}</p>;
  const snapshot = audition.snapshot;
  const controllers = running && snapshot && snapshot.definitions.length > 0 && (
    <div role="group" aria-label={copy.controls} className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
      {snapshot.definitions.map(d => <AuditionControl key={d.node_id} definition={d}
        value={audition.values[d.node_id] ?? d.default} alwaysOn={snapshot.alwaysOn} language={language}
        onChange={value => audition.changeValue(d, value)} />)}
    </div>
  );
  return <div className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2">
      {editorHosts?.controls ? createPortal(<div className="flex flex-wrap items-center gap-4">{toggle}{controllers}</div>, editorHosts.controls) : toggle}
      {children}
    </div>
    {running && audition.snapshot && <div className="mt-2 flex min-w-0 flex-col gap-2 border-t border-slate-700/60 pt-2">
      {!editorHosts?.controls && controllers}
      <AuditionPlayer initialNote={defaultAuditionNote(draft.graph)} disabled={!audition.snapshot.midi.length}
        language={language} pressNote={audition.pressNote} keyboardHost={keyboardHost} />
      {audition.stale && <p role="status" className="text-xs text-amber-200">{copy.stale}</p>}
    </div>}
    {emptySampler && <p className="mt-2 text-xs text-slate-300">{sampleCopy(language).emptyAudition}</p>}
    {editorHosts?.controls ? createPortal(error, editorHosts.controls) : error}
  </div>;
}
