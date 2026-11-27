import { useRef, useState } from "react";
import bank from "../../../backend/app/data/dx7-presets.json";
import type { GuiLanguage, NodeInstance } from "../types";
import { dx7Algorithms, dx7Frequency, dx7Name, dx7Offset, dx7OperatorMax, dx7Voice, encodeDx7 } from "../lib/dx7";
import { dx7Copy } from "../lib/dx7Copy";
import { fm6Copy } from "../lib/fm6Copy";
import { InstrumentAuditionKeyboard } from "./AuditionPanel";
import { Dx7Envelope } from "./Dx7Envelope";
import { Dx7VoiceImport } from "./Dx7VoiceImport";
import { FmAlgorithmCanvas } from "./FmAlgorithmCanvas";
import { NodeEditorModalFrame } from "./NodeEditorModalFrame";

const field = "block w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm text-slate-100";
const button = "rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700";
const group = "rounded-lg border border-slate-700 bg-slate-800/40 p-3";
const heading = "mb-2 text-sm font-semibold text-slate-100";

export function Dx7VoiceEditor({ node, language, onChange, onClose }: {
  node: NodeInstance; language: GuiLanguage;
  onChange: (voice: NodeInstance["params"]["voice"] | undefined, customVoice?: string) => void; onClose: () => void;
}) {
  const copy = dx7Copy(language), fm = fm6Copy(language);
  const opening = useRef({ voice: node.params.voice, custom: typeof node.params.custom_voice === "string" ? node.params.custom_voice : undefined });
  const [savedCustom, setSavedCustom] = useState(opening.current.custom);
  const [voice, setVoice] = useState(() => dx7Voice(node.params));
  const [name, setName] = useState(() => dx7Name(voice));
  const [selected, select] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const edited = useRef(false);
  const inspector = useRef<HTMLElement>(null);
  const route = dx7Algorithms[voice[134]];
  const offset = selected === null ? 0 : dx7Offset(selected);
  const encoded = encodeDx7(voice);
  const preset = savedCustom === undefined ? undefined : bank.presets.find(p => p.voice === encoded);
  const publish = (next: number[], custom?: string) => {
    edited.current = true;
    setVoice(next);
    setSavedCustom(custom);
    onChange(encodeDx7(next), custom);
  };
  const selectPreset = (id: number) => {
    const next = bank.presets.find(p => p.id === id);
    const bytes = dx7Voice({ voice: next?.voice ?? savedCustom ?? encoded });
    setName(dx7Name(bytes));
    publish(bytes, next ? savedCustom ?? encoded : undefined);
  };
  const update = (index: number, value: number) => {
    const next = [...voice]; next[index] = value; publish(next);
  };
  const cancel = () => { if (edited.current) onChange(opening.current.voice, opening.current.custom); onClose(); };
  const range = (index: number, label: string, max: number, shift = 0) =>
    <label key={index} className="block min-w-0 text-xs text-slate-300">
      <span className="flex items-baseline justify-between gap-2"><span>{label}</span>
        <span className="font-mono tabular-nums text-cyan-200">{voice[index] - shift}</span></span>
      <input type="range" aria-label={label} className="block h-5 w-full accent-cyan-300" min={-shift} max={max - shift}
        value={voice[index] - shift} onChange={e => update(index, e.currentTarget.valueAsNumber + shift)} />
    </label>;
  const choice = (index: number, label: string, options: string[]) =>
    <label className="block text-xs text-slate-300">{label}<select className={field} aria-label={label}
      value={voice[index]} onChange={e => update(index, Number(e.target.value))}>
      {options.map((name, value) => <option key={value} value={value}>{name}</option>)}</select></label>;
  const toggle = (index: number, label: string) => <label className="flex items-center gap-2 text-xs text-slate-300">
    <input type="checkbox" checked={Boolean(voice[index])} className="accent-cyan-300"
      onChange={e => update(index, Number(e.target.checked))} />{label}</label>;
  const envelope = (start: number, pitch = false) => <div>
    <h4 className={heading}>{pitch ? copy.pitchEG : copy.envelope}</h4>
    <div className="mb-2 h-20 rounded bg-slate-950/70 px-2 py-1"><Dx7Envelope detail pitch={pitch} voice={voice}
      offset={start} label={pitch ? copy.pitchEG : copy.envelope} keyOff={copy.keyOff} /></div>
    <div className="grid grid-cols-4 gap-3">{[0, 1, 2, 3].map(i => <div key={i} className="space-y-1">
      {range(start + i, `${copy.rate} ${i + 1}`, 99)}{range(start + 4 + i, `${copy.levelEG} ${i + 1}`, 99)}
    </div>)}</div>
  </div>;
  const selectOperator = (op: number) => {
    select(op);
    if (window.matchMedia?.("(max-width: 639px)").matches) requestAnimationFrame(() => inspector.current?.scrollIntoView({ block: "nearest" }));
  };
  const footer = <div className="flex w-full flex-wrap items-center justify-between gap-2">
    <span className="text-xs text-slate-400">{copy.next}</span><div className="flex gap-2">
      <button className={button} onClick={cancel}>{fm.cancel}</button>
      <button className="rounded bg-cyan-300 px-3 py-1.5 text-sm font-semibold text-slate-950" onClick={onClose}>{fm.apply}</button>
    </div></div>;
  return <><NodeEditorModalFrame ariaLabel={copy.title} title={copy.title} nodeId={node.id} nodeLabel={fm.node}
    closeLabel={fm.close} onClose={cancel} closeOnEscape maxWidthClassName="max-w-6xl" maxHeightClassName="max-h-[95dvh]" footer={footer}>
    <div className="space-y-3 text-slate-100">
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1.6fr_1.25fr_.7fr_1fr_auto]">
        <label className="text-xs text-slate-300">{fm.preset}
          <select className={field} aria-label={fm.preset} value={preset?.id ?? 0} onChange={e => selectPreset(Number(e.target.value))}>
            <option value={0}>0 · {fm.custom}</option>
            {Object.entries(copy.groups).map(([key, label]) => <optgroup key={key} label={label}>
              {bank.presets.filter(p => p.group === key).map(p => <option key={p.id} value={p.id}>{p.id} · {p.name}</option>)}
            </optgroup>)}
          </select>
        </label>
        <label className="text-xs text-slate-300">{copy.name}<input className={field} maxLength={10} value={name} onBlur={() => setName(dx7Name(voice))}
          onChange={e => {
            const text = e.target.value.replace(/[^ -~]/g, " ").slice(0, 10);
            setName(text);
            publish([...voice.slice(0, 145), ...Array.from(text.padEnd(10), c => c.charCodeAt(0))]);
          }} /></label>
        {choice(134, fm.algorithm, dx7Algorithms.map((_, i) => String(i + 1)))}
        {range(135, copy.feedback, 7)}
        <button className={button} onClick={() => setImporting(true)}>{copy.import}</button>
      </div>
      <FmAlgorithmCanvas algorithm={route} label={`${fm.algorithm} ${voice[134] + 1}`} copy={fm} selected={selected}
        onSelect={selectOperator} feedbackFrom={route.feedback[0]} feedbackTo={route.feedback[1]} feedbackOn={voice[135] > 0}
        feedbackLabel={String(voice[135])} operator={op => {
          const start = dx7Offset(op), level = voice[start + 16], frequency = dx7Frequency(voice, start);
          const detune = voice[start + 20] - 7;
          return { level: 100 * level / 99, outputLabel: `${copy.level} ${level} / 99`, enabled: true, title: `OP ${op} · ${frequency.label} · ${copy.level} ${level}`,
            details: (w, ink) => {
              const scaleWidth = w * .43 - 9, detuneWidth = w * .25;
              const marker = frequency.fixed ? Math.log10(frequency.value)/4.27 : Math.log2(frequency.value/.5)/Math.log2(31*2.27/.5);
              return <>
                <text x="11" y="39" fill="#eef3f8" fontSize="14" fontWeight="600">{frequency.label}</text>
                <text x={w - 10} y="39" fill="#cad7e3" textAnchor="end" fontSize="12">Δ {detune > 0 ? "+" : ""}{detune}</text>
                <path d={`M11 46h${scaleWidth} M${w-10-detuneWidth} 46h${detuneWidth} M${w-10-detuneWidth/2} 43v6`} stroke="#65808a" />
                <circle cx={11 + scaleWidth*marker} cy="46" r="2.5" fill={ink} />
                <circle cx={w - 10 - detuneWidth * (1 - voice[start + 20]/14)} cy="46" r="2.5" fill={ink} />
                <svg x="10" y="54" width={w * .48} height="24"><Dx7Envelope voice={voice} offset={start} ink={ink} label={`OP ${op} · ${copy.envelope}`} /></svg>
                <text x={w - 10} y="65" textAnchor="end" fontSize="11" fill={ink}>{level} / 99</text>
                <path d={`M${w*.62} 73H${w-10}`} stroke="#536675" strokeWidth="4" strokeLinecap="round" />
                <path d={`M${w*.62} 73h${(w*.38-10)*level/99}`} stroke={ink} strokeWidth="4" strokeLinecap="round" />
              </>;
            }
          };
        }} />
      <InstrumentAuditionKeyboard withControls />
      {selected === null ? <p className="text-xs text-slate-300">{copy.select}</p> :
        <section ref={inspector} className={group} aria-label={`${fm.operator} ${selected}`}>
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{fm.operator} {selected} · {route.outputs.includes(selected) ? fm.carrier : fm.modulator}</h3>
            <button className={button} aria-label={fm.hideOperator} onClick={() => select(null)}>×</button>
          </header>
          <div className="grid gap-5 md:grid-cols-2">
            {envelope(offset)}
            <div><h4 className={heading}>{copy.oscillator}</h4><div className="grid grid-cols-2 gap-x-5 gap-y-2">
              {choice(offset + 17, copy.mode, [copy.ratio, copy.fixed])}{range(offset + 16, copy.level, 99)}
              {range(offset + 18, copy.coarse, 31)}{range(offset + 19, copy.fine, voice[offset + 19] > 99 ? dx7OperatorMax[19] : 99)}
              {range(offset + 20, copy.detune, 14, 7)}{range(offset + 15, copy.velocity, 7)}
            </div></div>
          </div>
          <details className="mt-3 border-t border-slate-700 pt-2"><summary className="cursor-pointer text-sm">{copy.scaling}</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {range(offset + 8, copy.breakpoint, 99)}{range(offset + 9, copy.leftDepth, 99)}{range(offset + 10, copy.rightDepth, 99)}
              {range(offset + 13, copy.rateScale, 7)}{choice(offset + 11, copy.leftCurve, ["−LIN", "−EXP", "+EXP", "+LIN"])}
              {choice(offset + 12, copy.rightCurve, ["−LIN", "−EXP", "+EXP", "+LIN"])}{range(offset + 14, copy.ams, 3)}
            </div></details>
        </section>}
      <details className={group}><summary className="cursor-pointer text-sm">{copy.globals}</summary>
        <div className="mt-3 grid gap-5 md:grid-cols-2">{envelope(126, true)}<div className="grid grid-cols-2 gap-3">
          {range(144, copy.transpose, 48, 24)}{choice(142, copy.lfoWave, copy.waves)}
          {range(137, copy.lfoSpeed, 99)}{range(138, copy.lfoDelay, 99)}{range(139, copy.pmd, 99)}
          {range(140, copy.amd, 99)}{range(143, copy.pms, 7)}{toggle(136, copy.oscSync)}{toggle(141, copy.lfoSync)}
        </div></div>
      </details>
    </div>
  </NodeEditorModalFrame>
  {importing && <Dx7VoiceImport node={{ ...node, params: { ...node.params, voice: encodeDx7(voice) } }} language={language}
    onClose={() => setImporting(false)} onSelect={value => { const next = dx7Voice({ voice: value }); setName(dx7Name(next)); publish(next); }} />}
  </>;
}
