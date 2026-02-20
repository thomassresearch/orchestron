import type { CompileResponse, GuiLanguage, MidiInputRef, SessionEvent } from "../types";

interface RuntimePanelProps {
  guiLanguage: GuiLanguage;
  midiInputs: MidiInputRef[];
  selectedMidiInput?: string | null;
  compileOutput: CompileResponse | null;
  events: SessionEvent[];
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
  onBindMidiInput,
  onToggleCollapse
}: RuntimePanelProps) {
  const copy = RUNTIME_PANEL_COPY[guiLanguage];
  const recentEvents = [...events].slice(-10).reverse();

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
