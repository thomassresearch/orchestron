import { useEffect, useRef, useState } from "react";
import { ChevronRight, Trash2, Upload } from "lucide-react";
import factory from "../../../../backend/app/data/dx7-presets.json";
import { api } from "../../api/client";
import { cartridgeNames } from "../../lib/dx7Banks";
import { dx7Name, dx7Voice } from "../../lib/dx7";
import { performanceControllerCopy } from "../../lib/performanceControllerCopy";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage, PerformanceControllerDefinition, SequencerInstrumentBinding } from "../../types";
import "./dx7BankRack.css";

const copy = {
  english: { bank: "Bank", preset: "Preset", factory: "Factory", editor: "Editor voice", manage: "Manage banks", slot: "Cartridge slot", load: "Import .syx", replace: "Replace .syx", remove: "Remove", invalid: "Choose a 32-voice DX7 cartridge.", stale: "The rack changed. Try again.", saved: "Performance saved.", display: "Selected preset" },
  german: { bank: "Bank", preset: "Preset", factory: "Werkspresets", editor: "Editorstimme", manage: "Bänke verwalten", slot: "Speicherplatz", load: ".syx importieren", replace: ".syx ersetzen", remove: "Entfernen", invalid: "Eine DX7-Bank mit 32 Stimmen auswählen.", stale: "Rack geändert. Erneut versuchen.", saved: "Performance gespeichert.", display: "Gewähltes Preset" },
  french: { bank: "Banque", preset: "Préréglage", factory: "Usine", editor: "Voix de l’éditeur", manage: "Gérer les banques", slot: "Emplacement", load: "Importer .syx", replace: "Remplacer .syx", remove: "Retirer", invalid: "Choisissez une banque DX7 de 32 voix.", stale: "Le rack a changé. Réessayez.", saved: "Performance enregistrée.", display: "Préréglage sélectionné" },
  spanish: { bank: "Banco", preset: "Preajuste", factory: "Fábrica", editor: "Voz del editor", manage: "Gestionar bancos", slot: "Ranura", load: "Importar .syx", replace: "Reemplazar .syx", remove: "Quitar", invalid: "Elige un banco DX7 de 32 voces.", stale: "El rack ha cambiado. Inténtalo de nuevo.", saved: "Performance guardada.", display: "Preajuste seleccionado" }
};
const slots = Array.from({length: 16}, (_, i) => i + 1);
const digits = (value: number) => String(value).padStart(2, "0");

type Props = { binding: SequencerInstrumentBinding; language: GuiLanguage; running: boolean;
  definitions: PerformanceControllerDefinition[]; patchRevision?: string };

export function Dx7BankRack({binding, language, running, definitions, patchRevision}: Props) {
  const t = copy[language];
  const [slot, setSlot] = useState(1);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editorName, setEditorName] = useState("");
  const alive = useRef(true);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setEditorName("");
    void api.getPatch(binding.patchId).then(patch => {
      const names = patch.graph.nodes.filter(node => node.opcode === "fm_dx7").map(node => dx7Name(dx7Voice(node.params)).trim());
      if (current && names.length && names.every(name => name === names[0])) setEditorName(names[0]);
    }).catch(() => {});
    return () => { current = false; };
  }, [binding.patchId, patchRevision]);
  const preparing = useAppStore(s => s.loading);
  const uploadingSamples = useAppStore(s => s.sampleUploads > 0);
  const dirty = useAppStore(s => !!s.dx7BankEdits[binding.id]);
  const setValue = useAppStore(s => s.setPerformanceControllerValue);
  const bank = definitions.find(d => d.dx7_role === "bank");
  const program = definitions.find(d => d.dx7_role === "program");
  if (!bank || !program) return null;
  const banks = binding.dx7Banks ?? {};
  const values = binding.performanceControllerValues ?? {};
  const selectedBank = values[bank.node_id] ?? 0;
  const current = banks[selectedBank];
  const bankNumber = current ? selectedBank : 0;
  const names = current ? cartridgeNames(current.data) : factory.presets.map(p => p.name);
  const selected = values[program.node_id] ?? 0;
  const name = selected === 0 ? editorName || t.editor : names[selected - 1] || t.preset;
  const locked = running || busy || preparing;

  async function importBank(source: File) {
    const state = useAppStore.getState();
    setError("");
    setSaved(false);
    if (source.size !== 4104) { setError(t.invalid); return; }
    setBusy(true);
    try {
      await api.dx7Voices(source);
      const data = btoa(String.fromCharCode(...new Uint8Array(await source.arrayBuffer())));
      if (!alive.current) return;
      if (!state.applyDx7Banks(binding, state.performanceWorkspaceGeneration, {...banks, [slot]: {name: source.name, data}})) setError(t.stale);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : t.invalid); }
    finally { if (alive.current) setBusy(false); }
  }

  async function save() {
    setError("");
    const success = await useAppStore.getState().saveCurrentPerformance();
    if (!alive.current) return;
    setSaved(success);
    if (!success) setError(useAppStore.getState().error ?? "");
  }

  function remove() {
    const next = {...banks};
    delete next[slot];
    const state = useAppStore.getState();
    setSaved(false);
    if (!state.applyDx7Banks(binding, state.performanceWorkspaceGeneration, next)) { setError(t.stale); return; }
    if (selectedBank === slot && bank) setValue(binding.id, bank.node_id, null);
    setError("");
  }

  return <fieldset className="dx7-rack">
    <legend>DX7</legend>
    <output className="dx7-readout" aria-label={t.display} aria-live="polite">
      <span className="dx7-address">B{digits(bankNumber)} <span>/</span> P{digits(selected)}</span>
      <span className="dx7-voice-name">{name}</span>
    </output>
    <div className="dx7-selectors">
      <label>{t.bank}<select aria-label={t.bank} value={bankNumber} onChange={e => setValue(binding.id, bank.node_id, Number(e.target.value))}>
        <option value={0}>00 · {t.factory}</option>
        {slots.filter(n => banks[n]).map(n => <option key={n} value={n}>{digits(n)} · {banks[n].name}</option>)}
      </select></label>
      <label>{t.preset}<select aria-label={t.preset} value={selected} onChange={e => setValue(binding.id, program.node_id, Number(e.target.value))}>
        <option value={0}>00 · {t.editor}</option>
        {names.map((label, i) => <option key={i} value={i + 1}>{digits(i + 1)} · {label || "—"}</option>)}
      </select></label>
    </div>
    <details className="dx7-cartridges">
      <summary><ChevronRight size={14} aria-hidden="true"/>{t.manage}</summary>
      <div className="dx7-bank-actions">
        <label>{t.slot}<select aria-label={t.slot} disabled={locked} value={slot} onChange={e => setSlot(Number(e.target.value))}>
          {slots.map(n => <option key={n} value={n}>{digits(n)} · {banks[n]?.name ?? "—"}</option>)}
        </select></label>
        <input hidden ref={file} type="file" accept=".syx" onChange={e => {
          const source = e.target.files?.[0]; e.target.value = ""; if (source) void importBank(source);
        }} />
        <button type="button" disabled={locked} onClick={() => file.current?.click()}><Upload size={13} aria-hidden="true"/>{banks[slot] ? t.replace : t.load}</button>
        {banks[slot] && <button type="button" disabled={locked} onClick={remove}><Trash2 size={13} aria-hidden="true"/>{t.remove}</button>}
        {dirty && <button type="button" className="dx7-save" disabled={busy || preparing || uploadingSamples} onClick={() => void save()}>{performanceControllerCopy(language).save}</button>}
      </div>
      {saved && !dirty && <p role="status">{t.saved}</p>}
      {error && <p role="alert">{error}</p>}
    </details>
  </fieldset>;
}
