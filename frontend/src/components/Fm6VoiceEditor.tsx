import { useMemo, useRef, useState } from "react";
import type { GuiLanguage, NodeInstance } from "../types";
import { FM6, FM6_FIELDS, FM6_GLOBALS, fm6Custom, fm6Ranges, fm6Voice, fm6WeightKey } from "../lib/fm6";
import { fm6Copy } from "../lib/fm6Copy";
import { Fm6Algorithm } from "./Fm6Algorithm";
import { NodeEditorModalFrame } from "./NodeEditorModalFrame";
import { InstrumentAuditionKeyboard } from "./AuditionPanel";

const fieldStyle = "min-w-0 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm text-slate-100";
const buttonStyle = "rounded border border-slate-600 px-3 py-1.5 text-xs hover:bg-slate-700 disabled:opacity-40";
const ranges = fm6Ranges();
const valid = (key: string, text: string) => text.trim() !== "" && Number.isFinite(Number(text))
  && Number(text) >= ranges[key][0] && Number(text) <= ranges[key][1];

export function Fm6VoiceEditor({ node, language, drivenInputs, onChange, onClose }: {
  node: NodeInstance; language: GuiLanguage; drivenInputs: Record<string, string>;
  onChange: (params: NodeInstance["params"]) => void; onClose: () => void;
}) {
  const copy = fm6Copy(language);
  const original = useRef(node.params);
  const [params, setParams] = useState(node.params);
  const inspector = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState<number | [number, number] | null>(null);
  const selected = typeof selection === "number" ? selection : null;
  const branch = Array.isArray(selection) ? selection : null;
  const weightKey = branch && fm6WeightKey(...branch);
  const percent = useMemo(() => new Intl.NumberFormat({ english: "en", german: "de", french: "fr", spanish: "es" }[language],
    { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }), [language]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [clipboard, setClipboard] = useState<Record<string, number> | null>(null);
  const [browse, setBrowse] = useState(Number(node.params.ipreset) || 0);
  const preset = drivenInputs.ipreset ? browse : Number(params.ipreset ?? 0);
  const voiceParams = { ...params, ipreset: preset };
  const voice = fm6Voice(voiceParams);
  const algorithm = FM6.algorithms[voice.algorithm - 1];
  const scalar = (key: string, fallback: number) => Number.isFinite(Number(params[key])) ? Number(params[key]) : fallback;
  const envelopeScale = (key: "iattack_scale" | "irelease_scale") => {
    const [min, max, fallback] = FM6_GLOBALS[key];
    return Math.min(max, Math.max(min, scalar(key, fallback)));
  };
  const invalid = Object.entries(drafts).some(([key, text]) => !valid(key, text));
  const publish = (next: NodeInstance["params"]) => { setParams(next); onChange(next); };
  const cancel = () => { if (params !== original.current) onChange(original.current); onClose(); };
  const updateVoice = (changes: Record<string, number>) => {
    const next = fm6Custom(voiceParams, changes);
    if (drivenInputs.ipreset) {
      setBrowse(0);
      if (params.ipreset === undefined) delete next.ipreset;
      else next.ipreset = params.ipreset;
    }
    publish(next);
  };
  const select = (next: typeof selection) => {
    setSelection(next);
    if (typeof next === "number" && window.matchMedia?.("(max-width: 639px)").matches) {
      requestAnimationFrame(() => inspector.current?.scrollIntoView({ block: "nearest" }));
    }
    // Incomplete text belongs to the inspector being left. The graph holds its last valid value.
    setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith("op") && !key.startsWith("weight_"))));
  };
  const numeric = (key: string, label: string, value: number, custom = false) => {
    const [min, max] = ranges[key];
    const source = drivenInputs[key];
    const logarithmic = /_(attack|decay|release|scale)$/.test(key);
    const change = (text: string) => {
      setDrafts(previous => ({ ...previous, [key]: text }));
      if (valid(key, text)) {
        if (custom) updateVoice({ [key]: Number(text) });
        else publish({ ...params, [key]: Number(text) });
      }
    };
    return <div key={key} className="min-w-0 space-y-1 text-xs text-slate-300">
      <div className="flex items-center justify-between gap-2"><span>{label}</span>
        {!source && <input aria-label={label} title={`${min}–${max}`} className={`${fieldStyle} w-16 text-right font-mono text-xs aria-[invalid=true]:border-rose-400`}
          inputMode="decimal" value={drafts[key] ?? String(value)} aria-invalid={drafts[key] !== undefined && !valid(key, drafts[key])}
          onChange={e => change(e.target.value)} />}</div>
      {source ? <span className="block break-words text-cyan-200">{copy.driven} · {source}</span> :
        <input aria-label={`${label} · ${min}–${max}`} type="range" className="block h-4 w-full accent-cyan-300"
          min={logarithmic ? Math.log(min) : min} max={logarithmic ? Math.log(max) : max} step="any"
          value={logarithmic ? Math.log(Math.max(min, value)) : value} aria-valuetext={String(value)}
          onChange={e => {
            const position = Number(e.target.value);
            const number = Number((logarithmic ? Math.exp(position) : position).toPrecision(4));
            change(String(Math.min(max, Math.max(min, number))));
          }} />}
    </div>;
  };
  const prefix = `op${selected}_`;
  return <NodeEditorModalFrame ariaLabel={copy.title} title={copy.title} nodeId={node.id} nodeLabel={copy.node} closeLabel={copy.close}
    onClose={cancel} closeOnEscape maxWidthClassName="max-w-6xl" maxHeightClassName="max-h-[95dvh]" footer={<div className="flex w-full flex-wrap items-center justify-between gap-2">
      <span className={`text-xs ${invalid ? "text-rose-300" : "text-slate-400"}`}>{invalid ? copy.invalid : copy.changed}</span>
      <div className="flex gap-2"><button className={buttonStyle} onClick={cancel}>{copy.cancel}</button>
        <button disabled={invalid} className="rounded bg-cyan-300 px-3 py-1.5 text-sm font-semibold text-slate-950 disabled:opacity-40" onClick={onClose}>{copy.apply}</button></div>
    </div>}>
    <div className="space-y-3 text-slate-100">
      <div className="grid items-end gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-slate-300">{copy.preset}
          <select aria-label={copy.preset} className={fieldStyle} value={preset} onChange={e => { const id = Number(e.target.value);
            if (drivenInputs.ipreset) setBrowse(id); else publish({ ...params, ipreset: id });
            if (branch) setSelection(null); setDrafts({}); }}>
            <option value={0}>0 · {copy.custom}</option>{FM6.presets.map(p => <option key={p.id} value={p.id}>{p.id} · {p.name}</option>)}
          </select></label>
        <label className="flex flex-col gap-1 text-xs text-slate-300">{copy.algorithm}
          <select aria-label={copy.algorithm} className={fieldStyle} value={voice.algorithm} onChange={e => { updateVoice({ algorithm: Number(e.target.value) }); if (branch) setSelection(null); setDrafts({}); }}>
            {FM6.algorithms.map(a => <option key={a.id} value={a.id}>{a.id} · {copy.algorithms[a.id - 1]}</option>)}
          </select></label>
        {numeric("feedback", copy.feedback, voice.feedback, true)}
      </div>
      {drivenInputs.ipreset && <p className="rounded border-l-2 border-amber-600 bg-amber-950/30 px-3 py-2 text-xs text-amber-100" title={drivenInputs.ipreset}>{copy.presetDriven}</p>}
      <Fm6Algorithm voice={voice} copy={copy} selected={selected} onSelect={select} selectedWeight={weightKey} percent={percent}
        onSelectBranch={(from, to) => select([from, to])} onWeight={(key, value) => updateVoice({ [key]: value })}
        attackScale={envelopeScale("iattack_scale")} releaseScale={envelopeScale("irelease_scale")} />
      {branch && weightKey ? <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
        <h3 className="mb-2 text-sm font-semibold">{copy.operator} {branch[0]} → {copy.operator} {branch[1]}</h3>
        <div className="max-w-sm">{numeric(weightKey, copy.branchWeight, voice[weightKey], true)}</div>
        <p className="mt-2 text-xs text-slate-300">{copy.branchHelp}</p>
      </section> : selected === null ? <p className="text-xs text-slate-300">{copy.selectOperator}</p> :
        <section ref={inspector} className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{copy.operator} {selected} · {algorithm.outputs.includes(selected) ? copy.carrier : copy.modulator}</h3>
            <div className="flex flex-wrap items-center gap-2"><label className="mr-2 flex items-center gap-2 text-xs"><input type="checkbox" className="accent-cyan-300" checked={Boolean(voice[prefix + "enabled"])} onChange={e => updateVoice({ [prefix + "enabled"]: e.target.checked ? 1 : 0 })} />{copy.enabled}</label>
              <button className={buttonStyle} onClick={() => setClipboard(Object.fromEntries(FM6_FIELDS.map(k => [k, voice[prefix + k]])))}>{copy.copy}</button>
              <button className={buttonStyle} disabled={!clipboard} onClick={() => { if (clipboard) { updateVoice(Object.fromEntries(Object.entries(clipboard).map(([k, v]) => [prefix + k, v]))); setDrafts({}); } }}>{copy.paste}</button>
              <button className={buttonStyle} aria-label={copy.hideOperator} title={copy.hideOperator} onClick={() => select(null)}>×</button>
            </div>
          </div>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">{FM6_FIELDS.filter(k => k !== "enabled").map(k => numeric(prefix + k, copy[k], voice[prefix + k], true))}</div>
        </section>}
      {algorithm.edges.length === 0 && <p className="text-xs text-slate-400">{copy.silentBrightness}</p>}
      <details className="rounded-lg border border-slate-700 px-3 py-2"><summary className="cursor-pointer text-sm">{copy.controls}</summary>
        <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(FM6_GLOBALS).map(([key, range]) => numeric(key, copy[key as keyof typeof FM6_GLOBALS], scalar(key, range[2])))}</div>
        <p className="mt-2 text-xs text-slate-400">{copy.inherited}</p>
      </details>
      <InstrumentAuditionKeyboard />
    </div>
  </NodeEditorModalFrame>;
}
