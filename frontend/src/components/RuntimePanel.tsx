import type { Ref } from "react";

import type { CompileResponse, GuiLanguage, MidiInputRef, SessionEvent } from "../types";

interface RuntimePanelProps {
  guiLanguage: GuiLanguage;
  midiInputs: MidiInputRef[];
  selectedMidiInput?: string | null;
  compileOutput: CompileResponse | null;
  events: SessionEvent[];
  browserAudioStatus?: "off" | "connecting" | "live" | "error";
  browserAudioError?: string | null;
  browserAudioElementRef?: Ref<HTMLAudioElement>;
  onBindMidiInput: (midiInput: string) => void;
  onToggleCollapse?: () => void;
}

const RUNTIME_PANEL_COPY: Record<
  GuiLanguage,
  {
    title: string;
    hide: string;
    collapseRuntimePanel: string;
    midiInput: string;
    selectMidiInput: string;
    compileOutput: string;
    compileOutputEmpty: string;
    browserAudio: string;
    browserAudioOff: string;
    browserAudioConnecting: string;
    browserAudioLive: string;
    browserAudioError: string;
    sessionEvents: string;
    noEvents: string;
  }
> = {
  english: {
    title: "Runtime",
    hide: "Hide",
    collapseRuntimePanel: "Collapse runtime panel",
    midiInput: "MIDI Input",
    selectMidiInput: "Select MIDI input",
    compileOutput: "Compile Output",
    compileOutputEmpty: "Compile to view generated ORC.",
    browserAudio: "Browser Audio",
    browserAudioOff: "Local output mode",
    browserAudioConnecting: "Connecting WebRTC stream...",
    browserAudioLive: "Streaming to browser",
    browserAudioError: "Browser stream error",
    sessionEvents: "Session Events",
    noEvents: "No events yet."
  },
  german: {
    title: "Runtime",
    hide: "Ausblenden",
    collapseRuntimePanel: "Runtime-Panel einklappen",
    midiInput: "MIDI-Eingang",
    selectMidiInput: "MIDI-Eingang waehlen",
    compileOutput: "Compile-Ausgabe",
    compileOutputEmpty: "Kompilieren, um generiertes ORC zu sehen.",
    browserAudio: "Browser-Audio",
    browserAudioOff: "Lokaler Ausgabemodus",
    browserAudioConnecting: "WebRTC-Stream verbindet...",
    browserAudioLive: "Stream zum Browser aktiv",
    browserAudioError: "Browser-Stream-Fehler",
    sessionEvents: "Session-Events",
    noEvents: "Noch keine Events."
  },
  french: {
    title: "Runtime",
    hide: "Masquer",
    collapseRuntimePanel: "Reduire panneau runtime",
    midiInput: "Entree MIDI",
    selectMidiInput: "Selectionner entree MIDI",
    compileOutput: "Sortie de compilation",
    compileOutputEmpty: "Compilez pour voir le ORC genere.",
    browserAudio: "Audio navigateur",
    browserAudioOff: "Mode sortie locale",
    browserAudioConnecting: "Connexion du flux WebRTC...",
    browserAudioLive: "Flux vers navigateur actif",
    browserAudioError: "Erreur flux navigateur",
    sessionEvents: "Evenements de session",
    noEvents: "Pas encore d'evenements."
  },
  spanish: {
    title: "Runtime",
    hide: "Ocultar",
    collapseRuntimePanel: "Contraer panel runtime",
    midiInput: "Entrada MIDI",
    selectMidiInput: "Seleccionar entrada MIDI",
    compileOutput: "Salida de compilacion",
    compileOutputEmpty: "Compila para ver el ORC generado.",
    browserAudio: "Audio del navegador",
    browserAudioOff: "Modo de salida local",
    browserAudioConnecting: "Conectando flujo WebRTC...",
    browserAudioLive: "Flujo al navegador activo",
    browserAudioError: "Error de flujo del navegador",
    sessionEvents: "Eventos de sesion",
    noEvents: "Aun no hay eventos."
  }
};

export function RuntimePanel({
  guiLanguage,
  midiInputs,
  selectedMidiInput,
  compileOutput,
  events,
  browserAudioStatus = "off",
  browserAudioError = null,
  browserAudioElementRef,
  onBindMidiInput,
  onToggleCollapse
}: RuntimePanelProps) {
  const copy = RUNTIME_PANEL_COPY[guiLanguage];
  const recentEvents = [...events].slice(-10).reverse();
  const showBrowserAudio = browserAudioStatus !== "off" || browserAudioElementRef != null;
  const browserAudioStatusText =
    browserAudioStatus === "live"
      ? copy.browserAudioLive
      : browserAudioStatus === "connecting"
        ? copy.browserAudioConnecting
        : browserAudioStatus === "error"
          ? copy.browserAudioError
          : copy.browserAudioOff;

  return (
    <aside className="flex h-full flex-col rounded-2xl border border-slate-700/70 bg-slate-900/75 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm uppercase tracking-[0.24em] text-slate-300">{copy.title}</h2>
        {onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="mr-10 rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300 transition hover:bg-slate-800"
            aria-label={copy.collapseRuntimePanel}
            title={copy.collapseRuntimePanel}
          >
            {copy.hide}
          </button>
        ) : null}
      </div>

      <label className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-400">
        {copy.midiInput}
        <select
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
          value={selectedMidiInput ?? ""}
          onChange={(event) => onBindMidiInput(event.target.value)}
        >
          <option value="">{copy.selectMidiInput}</option>
          {midiInputs.map((input) => (
            <option key={input.id} value={input.id}>
              {input.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/80 p-2">
        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{copy.compileOutput}</div>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-slate-300">
          {compileOutput ? compileOutput.orc : copy.compileOutputEmpty}
        </pre>
      </div>

      {showBrowserAudio ? (
        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/80 p-2">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{copy.browserAudio}</div>
          <div className="mt-2 text-[11px] text-slate-300">{browserAudioStatusText}</div>
          {browserAudioError ? <div className="mt-1 text-[10px] text-rose-300">{browserAudioError}</div> : null}
          {browserAudioElementRef ? (
            <audio
              ref={browserAudioElementRef}
              className="mt-2 w-full"
              controls
              autoPlay
              playsInline
              preload="none"
            />
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex-1 rounded-xl border border-slate-700 bg-slate-950/80 p-2">
        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{copy.sessionEvents}</div>
        <div className="mt-2 space-y-2 overflow-y-auto font-mono text-[10px] text-slate-300">
          {recentEvents.length === 0 ? (
            <div className="text-slate-500">{copy.noEvents}</div>
          ) : (
            recentEvents.map((event, index) => (
              <div key={`${event.ts}-${event.type}-${index}`} className="rounded-md border border-slate-700 bg-slate-900 p-2">
                <div className="text-accent">{event.type}</div>
                <div className="text-slate-500">{new Date(event.ts).toLocaleTimeString()}</div>
                <div className="text-slate-400">{JSON.stringify(event.payload)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
