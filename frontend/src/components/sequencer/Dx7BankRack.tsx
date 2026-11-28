import {useEffect, useRef, useState} from "react";
import {api} from "../../api/client";
import {cartridgeNames} from "../../lib/dx7Banks";
import {useAppStore} from "../../store/useAppStore";
import type {GuiLanguage, PerformanceControllerDefinition, SequencerInstrumentBinding} from "../../types";
import { SEQUENCER_UI_COPY } from "./sequencerUiCopy";
import factory from "../../../../backend/app/data/dx7-presets.json";

const labels = {
  english: ["Bank", "Program", "Instrument", "Editor voice", "Use instrument setting", "Cartridge slot", "Import .syx", "Replace .syx", "Remove", "Choose a 32-voice DX7 cartridge.", "The rack changed. Try again.", "Graph-controlled program", "Performance saved."],
  german: ["Bank", "Programm", "Instrument", "Editorstimme", "Instrumenteinstellung", "Speicherplatz", ".syx importieren", ".syx ersetzen", "Entfernen", "Eine DX7-Bank mit 32 Stimmen auswählen.", "Rack geändert. Erneut versuchen.", "Programm über Graph gesteuert", "Performance gespeichert."],
  french: ["Banque", "Programme", "Instrument", "Voix de l’éditeur", "Réglage de l’instrument", "Emplacement", "Importer .syx", "Remplacer .syx", "Retirer", "Choisissez une banque DX7 de 32 voix.", "Le rack a changé. Réessayez.", "Programme piloté par le graphe", "Performance enregistrée."],
  spanish: ["Banco", "Programa", "Instrumento", "Voz del editor", "Ajuste del instrumento", "Ranura", "Importar .syx", "Reemplazar .syx", "Quitar", "Elige un banco DX7 de 32 voces.", "El rack ha cambiado. Inténtalo de nuevo.", "Programa controlado por el grafo", "Performance guardada."]
};
const slots = Array.from({length: 16}, (_, i) => i + 1);
const control = "min-w-0 max-w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs disabled:opacity-50";
type Props = {binding: SequencerInstrumentBinding; language: GuiLanguage; running: boolean; definitions: PerformanceControllerDefinition[]};

export function Dx7BankRack({binding, language, running, definitions}: Props) {
  const [bankLabel, programLabel, instrument, editor, inherit, slotLabel, load, replace, remove, invalid, stale, driven, savedMessage] = labels[language];
  const [slot, setSlot] = useState(1);
  const [error, setError] = useState("");
  const [savedBinding, setSavedBinding] = useState<SequencerInstrumentBinding | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const file = useRef<HTMLInputElement>(null);
  const preparing = useAppStore(s => s.loading);
  const uploadingSamples = useAppStore(s => s.sampleUploads > 0);
  const setValue = useAppStore(s => s.setPerformanceControllerValue);
  const bank = definitions.find(d => d.dx7_role === "bank");
  const program = definitions.find(d => d.dx7_role === "program");
  if (!bank) return null;
  const banks = binding.dx7Banks ?? {};
  const selected = binding.performanceControllerValues?.[bank.node_id] ?? 0;
  const current = banks[selected];
  const names = current ? cartridgeNames(current.data) : factory.presets.map(p => p.name);
  const locked = running || busy || preparing;

  async function importBank(source: File) {
    const state = useAppStore.getState();
    setError("");
    setSavedBinding(null);
    if (source.size !== 4104) { setError(invalid); return; }
    setBusy(true);
    try {
      await api.dx7Voices(source);
      const data = btoa(String.fromCharCode(...new Uint8Array(await source.arrayBuffer())));
      if (!alive.current) return;
      if (!state.applyDx7Banks(binding, state.performanceWorkspaceGeneration, {...banks, [slot]: {name: source.name, data}})) setError(stale);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : invalid); }
    finally { if (alive.current) setBusy(false); }
  }

  async function savePerformance() {
    setError("");
    setSavedBinding(null);
    const saved = await useAppStore.getState().saveCurrentPerformance();
    if (!alive.current) return;
    if (saved) setSavedBinding(binding);
    else setError(useAppStore.getState().error ?? "");
  }

  function clear() {
    const next = {...banks};
    delete next[slot];
    const state = useAppStore.getState();
    if (!state.applyDx7Banks(binding, state.performanceWorkspaceGeneration, next)) { setError(stale); return; }
    if (selected === slot && bank) setValue(binding.id, bank.node_id, null);
    setError("");
  }

  return <fieldset className="mt-3 w-fit min-w-0 max-w-full rounded border border-slate-600 px-3 pb-3 text-xs text-slate-300">
    <legend className="px-1 text-cyan-200">DX7</legend>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid min-w-0 max-w-full gap-1">{bankLabel}<select aria-label={bankLabel} className={control} value={current ? selected : 0} onChange={e => setValue(binding.id, bank.node_id, Number(e.target.value))}>
        <option value={0}>0 · {instrument}</option>{slots.filter(n => banks[n]).map(n => <option key={n} value={n}>{n} · {banks[n].name}</option>)}
      </select></label>
      {program ? <label className="grid min-w-0 max-w-full gap-1">{programLabel}<select aria-label={programLabel} className={control} value={binding.performanceControllerValues?.[program.node_id] ?? -1}
        onChange={e => setValue(binding.id, program.node_id, Number(e.target.value))}>
        <option value={-1}>{inherit}</option><option value={0}>0 · {editor}</option>
        {names.map((name, i) => <option key={i} value={i + 1}>{i + 1} · {name}</option>)}
      </select></label> : <span>{driven}</span>}
    </div>
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <label className="grid min-w-0 max-w-full gap-1">{slotLabel}<select aria-label={slotLabel} className={control} disabled={locked} value={slot} onChange={e => setSlot(Number(e.target.value))}>
        {slots.map(n => <option key={n} value={n}>{n} · {banks[n]?.name ?? "—"}</option>)}
      </select></label>
      <input hidden ref={file} type="file" accept=".syx" onChange={e => {
        const source = e.target.files?.[0]; e.target.value = ""; if (source) void importBank(source);
      }} />
      <button className={control} disabled={locked} onClick={() => file.current?.click()}>{banks[slot] ? replace : load}</button>
      {banks[slot] && <button className={control} disabled={locked} onClick={clear}>{remove}</button>}
      <button type="button" className={control} disabled={busy || preparing || uploadingSamples} onClick={savePerformance}>
        {SEQUENCER_UI_COPY[language].savePerformance}
      </button>
    </div>
    {savedBinding === binding && <p role="status" className="mt-2 text-cyan-200">{savedMessage}</p>}
    {error && <p role="alert" className="mt-2 text-rose-300">{error}</p>}
  </fieldset>;
}
