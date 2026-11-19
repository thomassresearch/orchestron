import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAppStore } from "../store/useAppStore";
import { audioCopy } from "../lib/audioCopy";
import { MASTER, defaultStrip } from "../lib/audioRouting";
import { canBypassInsert, instrumentsWithInserts } from "../lib/insertRouting";
import { meterSnapshot, subscribeMeters } from "../lib/mixerRuntime";
import type { GuiLanguage, PatchListItem } from "../types";
import { MixerKnob } from "./MixerKnob";
import { usePerformanceEditorState } from "./sequencer/PerformanceEditorState";
import { SEQUENCER_UI_COPY } from "./sequencer/sequencerUiCopy";

const field = "min-w-0 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100";
const button = "rounded border border-slate-600 px-2 py-1 text-xs hover:border-slate-400 disabled:opacity-40";

export function Meter({ id, name }: { id: string; name: string }) {
  const value = useSyncExternalStore(subscribeMeters, () => meterSnapshot(id));
  const db = (gain: number) => gain > 0 ? Math.max(-60, 20 * Math.log10(gain)) : -60;
  return <div className="my-2" aria-label={`${name} meter`}>
    {(["L", "R"] as const).map((side) => <div key={side} className="mb-1 flex items-center gap-1 text-[9px]">
      <span>{side}</span><div className="relative h-2 flex-1 overflow-hidden rounded bg-slate-950">
        <div className="absolute h-full bg-emerald-500/70" style={{ width: `${(db(value[`rms${side}`]) + 60) / 60 * 100}%` }} />
        <div className="absolute h-full w-0.5 bg-amber-200" style={{ left: `${Math.min(99, (db(value[`peak${side}`]) + 60) / 60 * 100)}%` }} />
      </div><span className={value[`peak${side}`] >= 1 ? "text-red-400" : "text-slate-500"}>{value[`peak${side}`] >= 1 ? "CLIP" : value[`peak${side}`] > 0 ? db(value[`peak${side}`]).toFixed(0) : "−∞"}</span>
    </div>)}
  </div>;
}
// A scrolled-out strip has no meter listener. Remounting reads the current engine snapshot.
export function VisibleMeter({ id, name }: { id: string; name: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (!viewport.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio > 0), { threshold: [0, .001] });
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={viewport} className="ws-meter" data-meter-id={id}>
    {visible && <Meter id={id} name={name} />}
  </div>;
}

export function Gain({ value, max = 12, label, onChange, onFinal, vertical = false, language }: { value: number | null; max?: number; label: string; onChange: (value: number | null) => void; onFinal: () => void; vertical?: boolean; language: GuiLanguage }) {
  const t = audioCopy(language);
  return <label className={`ws-gain flex gap-2 ${vertical ? "flex-col items-center" : "items-center"}`}>
    <span className="text-xs text-slate-400">{label}</span>
    {!vertical ? <MixerKnob value={value ?? -61} min={-61} max={max} step={0.1} label={label} valueText={value === null ? "−∞ dB" : `${value} dB`} onChange={(v) => onChange(v <= -61 ? null : Math.max(-60, v))} onFinal={onFinal} /> : <input type="range" min={-61} max={max} step={0.1} value={value ?? -61} aria-label={label} title={t("reset")}
      onChange={(e) => onChange(Number(e.target.value) <= -61 ? null : Math.max(-60, Number(e.target.value)))} onPointerUp={onFinal} onKeyUp={onFinal} onDoubleClick={() => { onChange(0); onFinal(); }}
      className="h-36 accent-cyan-400 [direction:rtl] [writing-mode:vertical-lr]" />}
    <span className="ws-gain-value flex items-center gap-1"><input className={`${field} w-16 text-center`} aria-label={`${label} dB`} type="number" min={-60} max={max} step={0.1} placeholder="−∞" value={value ?? ""}
      onChange={(e) => { const n = e.target.value === "" ? null : Number(e.target.value); if (n === null || Number.isFinite(n)) onChange(n === null ? null : Math.max(-60, Math.min(max, n))); }} onBlur={onFinal} /><span className="text-[10px] text-slate-400">dB</span></span>
  </label>;
}

/** flushMixer also publishes failures to the shared mixer status. */
function finishMixerEdit() {
  void useAppStore.getState().flushMixer().catch(() => undefined);
}

export function InsertBypass({ id, name, patch, language, showStatus = false }: { id: string; name: string; patch?: PatchListItem; language: GuiLanguage; showStatus?: boolean }) {
  const t = audioCopy(language);
  const bypassed = useAppStore(s => s.mixer.strips[id]?.bypass ?? false);
  const eligible = useAppStore(s => canBypassInsert(s.audioGraph, id, patch));
  return <><button type="button" className={`ws-bypass ${button}`} data-mix-toggle aria-pressed={bypassed}
    aria-label={`${name} ${t("bypass")}`} disabled={!eligible}
    title={eligible ? `${name} · ${t(bypassed ? "insertBypassed" : "insertActive")} · ${t("bypassHelp")}` : t("bypassMapping")}
    onClick={() => { useAppStore.getState().setMixerStrip(id, { bypass: !bypassed }); finishMixerEdit(); }}>{t(bypassed && !showStatus ? "insertBypassed" : "bypass")}</button>
    {showStatus && <span className={`text-[10px] ${bypassed ? "text-amber-200" : "text-emerald-300"}`}>{t(bypassed ? "insertBypassed" : "insertActive")}</span>}</>;
}

export function StripControls({ id, language, preferredInsert }: { id: string; language: GuiLanguage; preferredInsert?: string }) {
  const t = audioCopy(language);
  const state = useAppStore(s => s.mixer.strips[id]) ?? defaultStrip();
  const graph = useAppStore(s => s.audioGraph);
  const bindings = useAppStore(s => s.sequencerInstruments);
  const patches = useAppStore(s => s.patches);
  const setStrip = useAppStore(s => s.setMixerStrip);
  const [picked, pick] = usePerformanceEditorState(id === MASTER ? "mixer" : `binding:${id}`, "compareInsert", "");
  // Rack numbers distinguish two copies of the same processor.
  const processors = useMemo(() => instrumentsWithInserts(graph, [id]).slice(1).flatMap(processorId => {
    const index = bindings.findIndex(b => b.id === processorId);
    if (index < 0) return [];
    const binding = bindings[index], patch = patches.find(p => p.id === binding.patchId);
    const name = patch?.name ?? audioCopy(language)("missing");
    return [{ id: processorId, patch, name: `${name} · ${SEQUENCER_UI_COPY[language].patch(index + 1)}` }];
  }), [graph, id, bindings, patches, language]);
  const current = processors.find(p => p.id === picked) ?? processors.find(p => p.id === preferredInsert) ?? processors[0];
  return <div className="ws-strip-controls">
    <Gain value={state.gainDb} label={t("gain")} vertical language={language} onChange={gainDb => setStrip(id, { gainDb })} onFinal={finishMixerEdit} />
    <div className="ws-strip-switches">{(id === MASTER ? ["mute"] as const : ["mute", "solo"] as const).map(key =>
      <button type="button" key={key} data-mix-toggle className={button} aria-pressed={state[key]} data-switch={key}
        onClick={() => { setStrip(id, { [key]: !state[key] }); finishMixerEdit(); }}>{t(key)}</button>)}</div>
    {current && <div className="ws-compare-insert">
      <select aria-label={t("inserts")} title={current.name} value={current.id} onChange={e => pick(e.target.value)}>
        {processors.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <InsertBypass id={current.id} name={current.name} patch={current.patch} language={language} />
    </div>}
  </div>;
}

export function AudioOutputMeter({ language }: { language: GuiLanguage }) {
  const name = audioCopy(language)("audioOutput");
  return <div className="ws-output"><strong>{name}</strong><VisibleMeter id="$output" name={name} /></div>;
}
