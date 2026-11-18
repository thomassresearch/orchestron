import { useId, useState } from "react";
import type { GuiLanguage, NodeInstance } from "../types";
import { FM6, FM6_FIELDS, FM6_GLOBALS, fm6Custom, fm6Ranges, fm6Voice } from "../lib/fm6";
import { fm6Copy } from "../lib/fm6Copy";
import { NodeEditorModalFrame } from "./NodeEditorModalFrame";

const fieldStyle = "w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm text-slate-100";
const buttonStyle = "rounded border border-slate-600 px-3 py-1.5 text-xs hover:bg-slate-700 disabled:opacity-40";

export function Fm6VoiceEditor({ node, language, drivenInputs, onSave, onClose }: {
  node: NodeInstance; language: GuiLanguage; drivenInputs: Record<string, string>;
  onSave: (params: NodeInstance["params"]) => void; onClose: () => void;
}) {
  const copy = fm6Copy(language);
  const [params, setParams] = useState({ ...node.params });
  const [selected, setSelected] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [clipboard, setClipboard] = useState<Record<string, number> | null>(null);
  const id = useId().replace(/:/g, "");
  const voice = fm6Voice(params);
  const scalar = (key: string, fallback: number) => Number.isFinite(Number(params[key])) ? Number(params[key]) : fallback;
  const algorithm = FM6.algorithms[Math.max(0, Math.min(7, voice.algorithm - 1))];
  const ranges = fm6Ranges();
  const valid = (key: string, text: string) => text.trim() !== "" && Number.isFinite(Number(text))
    && Number(text) >= ranges[key][0] && Number(text) <= ranges[key][1];
  const invalid = Object.entries(drafts).some(([key, text]) => !valid(key, text));
  const updateVoice = (changes: Record<string, number>) => setParams(previous => fm6Custom(previous, changes));
  const role = (op: number) => algorithm.outputs.includes(op) ? copy.carrier : copy.modulator;
  const numeric = (key: string, label: string, value: number, custom = false) => {
    const [min, max] = ranges[key];
    const source = drivenInputs[key];
    const logarithmic = key.endsWith("_attack") || key.endsWith("_decay") || key.endsWith("_release") || key.endsWith("_scale");
    const change = (text: string) => {
      setDrafts(previous => ({ ...previous, [key]: text }));
      if (valid(key, text)) {
        if (custom) updateVoice({ [key]: Number(text) });
        else setParams(previous => ({ ...previous, [key]: Number(text) }));
      }
    };
    return <label key={key} className="flex min-w-0 flex-col gap-1 text-xs text-slate-300">
      <span>{label}</span>
      {source ? <span className="break-words rounded bg-slate-800 p-2 text-cyan-200">{copy.driven}: {source}</span> : <>
        <input aria-label={label} className={fieldStyle} inputMode="decimal" value={drafts[key] ?? String(value)}
          aria-invalid={drafts[key] !== undefined && !valid(key, drafts[key])} onChange={event => change(event.target.value)} />
        <input aria-label={`${label} · ${min}–${max}`} type="range" className="w-full accent-cyan-400" min={logarithmic ? Math.log(min) : min}
          max={logarithmic ? Math.log(max) : max} step="any" value={logarithmic ? Math.log(Math.max(min, value)) : value}
          onChange={event => change(String(Number((logarithmic ? Math.exp(Number(event.target.value)) : Number(event.target.value)).toPrecision(4))))} />
      </>}
      <span className="text-slate-400">{min}–{max}</span>
    </label>;
  };
  const rows = Math.max(...algorithm.positions.map(p => p[1])) + 1;
  const pos = (op: number) => ({ x: 24 + algorithm.positions[op - 1][0] * 260, y: 34 + algorithm.positions[op - 1][1] * 50 });
  const busY = 34 + rows * 50;
  const prefix = `op${selected}_`;
  const attack = voice[prefix + "attack"] * scalar("iattack_scale", 1);
  const decay = voice[prefix + "decay"];
  const release = voice[prefix + "release"] * scalar("irelease_scale", 1);
  const total = attack + decay + .5 + release;
  const x = (time: number) => 10 + 280 * time / total;
  const sustainY = 60 - voice[prefix + "sustain"] * .5;
  const noteOff = attack + decay + .5;
  return <NodeEditorModalFrame ariaLabel={copy.title} title={copy.title} nodeId={node.id} nodeLabel={copy.node} closeLabel={copy.close}
    onClose={onClose} maxWidthClassName="max-w-4xl" footer={<div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700 p-4">
      <span className="max-w-xl text-xs text-slate-300">{invalid ? copy.invalid : copy.changed}</span>
      <div className="flex gap-2"><button className={buttonStyle} onClick={onClose}>{copy.cancel}</button>
        <button disabled={invalid} className="rounded bg-cyan-300 px-3 py-1.5 text-sm font-semibold text-slate-950 disabled:opacity-40" onClick={() => { onSave(params); onClose(); }}>{copy.apply}</button></div>
    </div>}>
    <div className="space-y-4 text-slate-100">
      {drivenInputs.ipreset && <p className="rounded border border-amber-800 bg-amber-950/50 p-3 text-xs text-amber-100">{copy.presetDriven}<br />{copy.driven}: {drivenInputs.ipreset}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          <label className="block space-y-1 text-sm">{copy.preset}<select className={fieldStyle} value={scalar("ipreset", 0)} onChange={e => { setParams(p => ({ ...p, ipreset: Number(e.target.value) })); setDrafts({}); }}>
            <option value={0}>0 · {copy.custom}</option>{FM6.presets.map(p => <option key={p.id} value={p.id}>{p.id} · {p.name}</option>)}
          </select></label>
          <label className="block space-y-1 text-sm">{copy.algorithm}<select className={fieldStyle} value={voice.algorithm} onChange={e => { updateVoice({ algorithm: Number(e.target.value) }); setDrafts({}); }}>
            {FM6.algorithms.map(a => <option key={a.id} value={a.id}>{a.id} · {copy.algorithms[a.id - 1]}</option>)}
          </select></label>
          {numeric("feedback", copy.feedback, voice.feedback, true)}
          <p className="text-xs text-slate-400">{copy.customEdit}</p>
          {algorithm.edges.length === 0 && <p className="text-xs text-slate-400">{copy.silentBrightness}</p>}
          <div className="flex flex-wrap gap-3 text-xs"><span className="text-cyan-200">● {copy.carrier}</span><span className="text-amber-200">● {copy.modulator}</span></div>
        </div>
        <svg viewBox={`0 0 330 ${busY + 45}`} className="mx-auto w-full max-w-[330px]" role="img" aria-label={`${copy.algorithm}: ${copy.algorithms[voice.algorithm - 1]}`}>
          <defs><marker id={`${id}-arrow`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="currentColor" /></marker></defs>
          <g className="text-slate-400" stroke="currentColor" fill="none" strokeWidth="1.3">
            {algorithm.edges.map(([source, target]) => <line key={`${source}-${target}`} x1={pos(source).x} y1={pos(source).y + 17} x2={pos(target).x} y2={pos(target).y - 19} markerEnd={`url(#${id}-arrow)`} />)}
            {algorithm.outputs.map(op => <line key={op} x1={pos(op).x} x2={pos(op).x} y1={pos(op).y + 17} y2={busY} />)}
            <line x1={Math.min(...algorithm.outputs.map(op => pos(op).x))} x2={Math.max(...algorithm.outputs.map(op => pos(op).x))} y1={busY} y2={busY} />
            <path d={`M${pos(6).x + 19} ${pos(6).y}h23v-27h-42v8`} strokeDasharray={voice.feedback === 0 ? "3 3" : undefined} markerEnd={`url(#${id}-arrow)`} />
          </g>
          {Array.from({ length: 6 }, (_, i) => i + 1).map(op => <g key={op} opacity={voice[`op${op}_enabled`] ? 1 : .35}>
            <rect x={pos(op).x - 17} y={pos(op).y - 16} width={34} height={32} rx={5} fill={algorithm.outputs.includes(op) ? "#164e63" : "#78350f"} stroke={selected === op ? "#e2e8f0" : "#475569"} strokeWidth={selected === op ? 2 : 1} />
            <text x={pos(op).x} y={pos(op).y + 5} textAnchor="middle" fill="#f8fafc" fontSize={14}>{op}</text>
          </g>)}
          <text x={165} y={busY + 25} textAnchor="middle" fill="#cbd5e1" fontSize={12}>{copy.output}</text>
        </svg>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{Array.from({ length: 6 }, (_, i) => i + 1).map(op =>
        <button key={op} aria-label={`${copy.operator} ${op} ${voice[`op${op}_enabled`] ? role(op) : copy.off}`} aria-pressed={selected === op} onClick={() => setSelected(op)} className={`rounded border p-2 text-xs ${selected === op ? "border-cyan-300 bg-cyan-950" : "border-slate-600 bg-slate-800"}`}>
          {copy.operator} {op}<span className="block text-slate-300">{voice[`op${op}_enabled`] ? role(op) : copy.off}</span>
        </button>)}</div>
      <section className="space-y-3 rounded border border-slate-700 bg-slate-950/50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{copy.operator} {selected} · {role(selected)}</h3>
          <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={Boolean(voice[prefix + "enabled"])} onChange={e => updateVoice({ [prefix + "enabled"]: e.target.checked ? 1 : 0 })} />{copy.enabled}</label>
            <button className={buttonStyle} onClick={() => setClipboard(Object.fromEntries(FM6_FIELDS.map(k => [k, voice[prefix + k]])))}>{copy.copy}</button>
            <button className={buttonStyle} disabled={!clipboard} onClick={() => { if (clipboard) { updateVoice(Object.fromEntries(Object.entries(clipboard).map(([k, v]) => [prefix + k, v]))); setDrafts({}); } }}>{copy.paste}</button></div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{FM6_FIELDS.filter(k => k !== "enabled").map(k => numeric(prefix + k, copy[k], voice[prefix + k], true))}</div>
        <svg viewBox="0 0 300 88" className="h-24 w-full" role="img" aria-label={`ADSR · ${copy.operator} ${selected}`}>
          <line x1={10} x2={290} y1={60} y2={60} stroke="#475569" />
          <path d={`M10 60L${x(attack)} 10L${x(attack + decay)} ${sustainY}L${x(noteOff)} ${sustainY}L290 60`} stroke="#67e8f9" fill="none" strokeWidth={1.5} />
          <line x1={x(noteOff)} x2={x(noteOff)} y1={6} y2={64} stroke="#94a3b8" strokeDasharray="3 3" />
          <text x={Math.max(35, Math.min(265, x(noteOff)))} y={80} textAnchor="middle" fontSize={10} fill="#cbd5e1">{copy.noteOff}</text>
        </svg>
      </section>
      <details open><summary className="cursor-pointer text-sm font-semibold">{copy.controls}</summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries(FM6_GLOBALS).map(([key, range]) => numeric(key, copy[key as keyof typeof copy] as string, Number(params[key] ?? range[2])))}</div>
        <p className="mt-2 text-xs text-slate-400">{copy.inherited}</p>
      </details>
    </div>
  </NodeEditorModalFrame>;
}
