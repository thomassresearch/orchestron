import { useRef, useState } from "react";
import { api, isApiError, type Dx7Voice } from "../api/client";
import type { GuiLanguage, NodeInstance } from "../types";
import { NodeEditorModalFrame } from "./NodeEditorModalFrame";

const labels = {
  english: ["Load DX7 voice", "Node", "Cancel", "Choose SysEx file", "Voice", "Algorithm", "Use voice", "Current voice", "Invalid DX7 dump. Choose a single voice or a 32-voice bank.", "Unable to load the file.", "Loading…"],
  german: ["DX7-Stimme laden", "Knoten", "Abbrechen", "SysEx-Datei wählen", "Stimme", "Algorithmus", "Stimme übernehmen", "Aktuelle Stimme", "Ungültiger DX7-Dump. Wähle eine Stimme oder eine Bank mit 32 Stimmen.", "Datei konnte nicht geladen werden.", "Lädt…"],
  french: ["Charger une voix DX7", "Nœud", "Annuler", "Choisir un fichier SysEx", "Voix", "Algorithme", "Utiliser la voix", "Voix actuelle", "Données DX7 invalides. Choisissez une voix ou une banque de 32 voix.", "Impossible de charger le fichier.", "Chargement…"],
  spanish: ["Cargar voz DX7", "Nodo", "Cancelar", "Elegir archivo SysEx", "Voz", "Algoritmo", "Usar voz", "Voz actual", "Datos DX7 no válidos. Elige una voz o un banco de 32 voces.", "No se pudo cargar el archivo.", "Cargando…"]
};

export function dx7ImportLabel(language: GuiLanguage) {
  return labels[language][0];
}

function currentName(node: NodeInstance) {
  if (typeof node.params.voice !== "string") return "INIT VOICE";
  try {
    return atob(node.params.voice).slice(145, 155).replace(/[^ -~]/g, " ").trim() || "—";
  } catch {
    return "—";
  }
}

export function Dx7VoiceImport({ node, language, onClose, onSelect }: {
  node: NodeInstance; language: GuiLanguage; onClose: () => void; onSelect: (voice: string) => void;
}) {
  const [title, nodeLabel, cancel, choose, voiceLabel, algorithm, apply, current, invalid, failed, loading] = labels[language];
  const [voices, setVoices] = useState<Dx7Voice[]>([]);
  const [index, setIndex] = useState(0);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("");
  const revision = useRef(0);
  async function read(file: File) {
    const version = ++revision.current;
    setFileName(file.name);
    setVoices([]);
    setIndex(0);
    if (file.size !== 163 && file.size !== 4104) { setStatus(invalid); return; }
    setStatus(loading);
    try {
      const result = await api.dx7Voices(file);
      if (version === revision.current) { setVoices(result); setStatus(""); }
    } catch (error) {
      if (version === revision.current) setStatus(isApiError(error) && error.status === 422 ? invalid : failed);
    }
  }
  return <NodeEditorModalFrame ariaLabel={title} title={title} nodeId={node.id} nodeLabel={nodeLabel} closeLabel={cancel}
    onClose={onClose} maxWidthClassName="max-w-md"
    footer={<button type="button" disabled={!voices[index]} className="rounded bg-cyan-300 px-3 py-1.5 text-sm font-semibold text-slate-950 disabled:opacity-40"
      onClick={() => { onSelect(voices[index].voice); onClose(); }}>{apply}</button>}>
    <p className="mb-4 text-sm text-slate-300">{current} · <strong>{currentName(node)}</strong></p>
    <label className="relative inline-block cursor-pointer rounded border border-slate-500 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-cyan-300">
      {choose}<input type="file" accept=".syx,application/octet-stream" className="sr-only" onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void read(file);
      }} />
    </label>
    <span className="ml-2 break-all text-xs text-slate-400">{fileName}</span>
    {voices.length > 0 && <label className="mt-5 block text-sm">{voiceLabel}
      <select className="mt-1 w-full rounded border border-slate-600 bg-slate-900 p-2" value={index} onChange={e => setIndex(Number(e.target.value))}>
        {voices.map((v, i) => <option key={i} value={i}>{i + 1} · {v.name || "—"} · {algorithm} {v.algorithm}</option>)}
      </select>
    </label>}
    <div role="status" className="mt-2 text-sm text-slate-300">{status}</div>
  </NodeEditorModalFrame>;
}
