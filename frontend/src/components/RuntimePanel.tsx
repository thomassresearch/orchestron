import type { CompileResponse, MidiInputRef, SessionEvent } from "../types";

interface RuntimePanelProps {
  midiInputs: MidiInputRef[];
  selectedMidiInput?: string | null;
  compileOutput: CompileResponse | null;
  events: SessionEvent[];
  onBindMidiInput: (midiInput: string) => void;
}

export function RuntimePanel({
  midiInputs,
  selectedMidiInput,
  compileOutput,
  events,
  onBindMidiInput
}: RuntimePanelProps) {
  const recentEvents = [...events].slice(-10).reverse();

  return (
    <aside className="flex h-full flex-col rounded-2xl border border-slate-700/70 bg-slate-900/75 p-3">
      <h2 className="font-display text-sm uppercase tracking-[0.24em] text-slate-300">Runtime</h2>

      <label className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-400">
        MIDI Input
        <select
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
          value={selectedMidiInput ?? ""}
          onChange={(event) => onBindMidiInput(event.target.value)}
        >
          <option value="">Select MIDI input</option>
          {midiInputs.map((input) => (
            <option key={input.id} value={input.id}>
              {input.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/80 p-2">
        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Compile Output</div>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-slate-300">
          {compileOutput ? compileOutput.orc : "Compile to view generated ORC."}
        </pre>
      </div>

      <div className="mt-4 flex-1 rounded-xl border border-slate-700 bg-slate-950/80 p-2">
        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Session Events</div>
        <div className="mt-2 space-y-2 overflow-y-auto font-mono text-[10px] text-slate-300">
          {recentEvents.length === 0 ? (
            <div className="text-slate-500">No events yet.</div>
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
