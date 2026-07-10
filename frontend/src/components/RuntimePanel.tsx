import type { CompileResponse, GuiLanguage, MidiInputRef, SessionEvent } from "../types";
import type { BrowserClockWorkerDiagnostics } from "../audio/browserClockWorkerProtocol";

interface RuntimePanelProps {
  guiLanguage: GuiLanguage;
  midiInputs: MidiInputRef[];
  selectedMidiInput?: string | null;
  compileOutput: CompileResponse | null;
  events: SessionEvent[];
  browserAudioTransport?: "off" | "browser_clock";
  browserAudioStatus?: "off" | "connecting" | "live" | "error";
  browserAudioError?: string | null;
  browserAudioDiagnostics?: BrowserClockWorkerDiagnostics | null;
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
    browserAudioBrowserClockConnecting: string;
    browserAudioBrowserClockLive: string;
    browserAudioBrowserClockError: string;
    audioQueue: string;
    pendingRender: string;
    underruns: string;
    overruns: string;
    renderRatio: string;
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
    browserAudioOff: "Browser-clock inactive",
    browserAudioBrowserClockConnecting: "Priming browser PCM queue...",
    browserAudioBrowserClockLive: "Browser-owned PCM runtime active",
    browserAudioBrowserClockError: "Browser PCM runtime error",
    audioQueue: "PCM queue",
    pendingRender: "Pending render",
    underruns: "Underruns",
    overruns: "Overruns",
    renderRatio: "Render/audio ratio",
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
    browserAudioOff: "Browser-Clock inaktiv",
    browserAudioBrowserClockConnecting: "PCM-Puffer im Browser wird vorbereitet...",
    browserAudioBrowserClockLive: "Browser-gesteuerte PCM-Laufzeit aktiv",
    browserAudioBrowserClockError: "Browser-PCM-Laufzeitfehler",
    audioQueue: "PCM-Puffer",
    pendingRender: "Ausstehendes Rendering",
    underruns: "Underruns",
    overruns: "Overruns",
    renderRatio: "Render-/Audio-Verhaeltnis",
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
    browserAudioOff: "Browser-clock inactif",
    browserAudioBrowserClockConnecting: "Preparation de la file PCM navigateur...",
    browserAudioBrowserClockLive: "Runtime PCM pilote par le navigateur actif",
    browserAudioBrowserClockError: "Erreur runtime PCM navigateur",
    audioQueue: "File PCM",
    pendingRender: "Rendu en attente",
    underruns: "Sous-alimentations",
    overruns: "Depassements",
    renderRatio: "Ratio rendu/audio",
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
    browserAudioOff: "Browser-clock inactivo",
    browserAudioBrowserClockConnecting: "Preparando cola PCM del navegador...",
    browserAudioBrowserClockLive: "Runtime PCM controlado por el navegador activo",
    browserAudioBrowserClockError: "Error del runtime PCM del navegador",
    audioQueue: "Cola PCM",
    pendingRender: "Render pendiente",
    underruns: "Subdesbordamientos",
    overruns: "Desbordamientos",
    renderRatio: "Relacion render/audio",
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
  browserAudioTransport = "off",
  browserAudioStatus = "off",
  browserAudioError = null,
  browserAudioDiagnostics = null,
  onBindMidiInput,
  onToggleCollapse
}: RuntimePanelProps) {
  const copy = RUNTIME_PANEL_COPY[guiLanguage];
  const recentEvents = [...events].slice(-10).reverse();
  const showBrowserAudio = browserAudioStatus !== "off";
  const browserAudioStatusText = (() => {
    if (browserAudioTransport === "browser_clock") {
      if (browserAudioStatus === "live") {
        return copy.browserAudioBrowserClockLive;
      }
      if (browserAudioStatus === "connecting") {
        return copy.browserAudioBrowserClockConnecting;
      }
      if (browserAudioStatus === "error") {
        return copy.browserAudioBrowserClockError;
      }
      return copy.browserAudioOff;
    }

    return copy.browserAudioOff;
  })();

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-700/70 bg-slate-900/75 p-3">
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

      <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-scroll pr-1">
        <label className="block text-xs uppercase tracking-[0.18em] text-slate-400">
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

        <div className="rounded-xl border border-slate-700 bg-slate-950/80 p-2">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{copy.compileOutput}</div>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-slate-300">
            {compileOutput ? compileOutput.orc : copy.compileOutputEmpty}
          </pre>
        </div>

        {showBrowserAudio ? (
          <div className="rounded-xl border border-slate-700 bg-slate-950/80 p-2">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{copy.browserAudio}</div>
          <div className="mt-2 text-[11px] text-slate-300">{browserAudioStatusText}</div>
          {browserAudioError ? <div className="mt-1 text-[10px] text-rose-300">{browserAudioError}</div> : null}
          {browserAudioDiagnostics ? (
            <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-slate-400">
              <dt>{copy.audioQueue}</dt>
              <dd className="text-right text-slate-200">
                {Math.round((browserAudioDiagnostics.queuedFrames * 1000) / Math.max(1, browserAudioDiagnostics.sampleRate))} ms
              </dd>
              <dt>{copy.pendingRender}</dt>
              <dd className="text-right text-slate-200">
                {Math.round((browserAudioDiagnostics.pendingRenderFrames * 1000) / Math.max(1, browserAudioDiagnostics.sampleRate))} ms
              </dd>
              <dt>{copy.underruns}</dt>
              <dd className="text-right text-slate-200">{browserAudioDiagnostics.underrunCount}</dd>
              <dt>{copy.overruns}</dt>
              <dd className="text-right text-slate-200">{browserAudioDiagnostics.overrunCount}</dd>
              <dt>{copy.renderRatio}</dt>
              <dd className="text-right text-slate-200">
                {browserAudioDiagnostics.renderTimeRatio === null
                  ? "-"
                  : `${Math.round(browserAudioDiagnostics.renderTimeRatio * 100)}%`}
              </dd>
            </dl>
          ) : null}
        </div>
      ) : null}

        <div className="rounded-xl border border-slate-700 bg-slate-950/80 p-2">
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
      </div>
    </aside>
  );
}
