import type { SequencerState } from "../types";

interface SequencerPageProps {
  sequencer: SequencerState;
  sessionState: string;
  midiInputName: string | null;
  transportError: string | null;
  webMidiSupported: boolean;
  onStartPlayback: () => void;
  onStopPlayback: () => void;
  onBpmChange: (bpm: number) => void;
  onMidiChannelChange: (channel: number) => void;
  onStepCountChange: (count: 16 | 32) => void;
  onStepNoteChange: (index: number, note: number | null) => void;
  onResetPlayhead: () => void;
  onAllNotesOff: () => void;
}

export function SequencerPage({
  sequencer,
  sessionState,
  midiInputName,
  transportError,
  webMidiSupported,
  onStartPlayback,
  onStopPlayback,
  onBpmChange,
  onMidiChannelChange,
  onStepCountChange,
  onStepNoteChange,
  onResetPlayhead,
  onAllNotesOff
}: SequencerPageProps) {
  const stepIndices = Array.from({ length: sequencer.stepCount }, (_, index) => index);

  return (
    <section className="rounded-2xl border border-slate-700/70 bg-slate-900/70 p-4 shadow-glow">
      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={onStartPlayback}
          disabled={sequencer.isPlaying}
          className="rounded-lg border border-emerald-400/50 bg-emerald-400/20 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300 transition hover:bg-emerald-400/30"
        >
          Start
        </button>
        <button
          type="button"
          onClick={onStopPlayback}
          disabled={!sequencer.isPlaying}
          className="rounded-lg border border-amber-400/50 bg-amber-400/20 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200 transition hover:bg-amber-400/30"
        >
          Stop
        </button>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.2em] text-slate-400">BPM</span>
          <input
            type="number"
            min={30}
            max={300}
            value={sequencer.bpm}
            onChange={(event) => onBpmChange(Number(event.target.value))}
            className="w-28 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.2em] text-slate-400">MIDI Channel</span>
          <input
            type="number"
            min={1}
            max={16}
            value={sequencer.midiChannel}
            onChange={(event) => onMidiChannelChange(Number(event.target.value))}
            className="w-32 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Steps</span>
          <div className="inline-flex rounded-lg border border-slate-600 bg-slate-950 p-1">
            <button
              type="button"
              onClick={() => onStepCountChange(16)}
              className={`rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                sequencer.stepCount === 16 ? "bg-accent/30 text-accent" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              16
            </button>
            <button
              type="button"
              onClick={() => onStepCountChange(32)}
              className={`rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                sequencer.stepCount === 32 ? "bg-accent/30 text-accent" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              32
            </button>
          </div>
        </div>

        <div className="ml-auto rounded-full border border-slate-700 bg-slate-950 px-3 py-1 font-mono text-xs text-slate-300">
          state: {sessionState}
        </div>
      </div>

      {!webMidiSupported && (
        <div className="mt-3 rounded-xl border border-amber-500/50 bg-amber-950/50 px-3 py-2 text-xs text-amber-200">
          Web MIDI is unavailable in this browser. Sequencer playback will use backend MIDI fallback.
        </div>
      )}

      {transportError && (
        <div className="mt-3 rounded-xl border border-rose-500/60 bg-rose-950/50 px-3 py-2 font-mono text-xs text-rose-200">
          {transportError}
        </div>
      )}

      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/80 p-3">
        <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Step Grid</div>
        <div className="overflow-x-auto pb-2">
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${sequencer.stepCount}, minmax(64px, 1fr))`,
              minWidth: `${Math.max(540, sequencer.stepCount * 72)}px`
            }}
          >
            {stepIndices.map((step) => {
              const noteValue = sequencer.steps[step];
              const isActive = sequencer.isPlaying && sequencer.playhead === step;

              return (
                <div
                  key={step}
                  className={`rounded-lg border p-2 transition ${
                    isActive
                      ? "border-accent bg-accent/15 shadow-[0_0_0_1px_rgba(14,165,233,0.55)]"
                      : "border-slate-700 bg-slate-900"
                  }`}
                >
                  <div className="text-center font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
                    {step + 1}
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={127}
                    value={noteValue === null ? "" : noteValue}
                    placeholder="--"
                    onChange={(event) => {
                      const raw = event.target.value.trim();
                      onStepNoteChange(step, raw.length === 0 ? null : Number(raw));
                    }}
                    className="mt-2 w-full rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-center font-mono text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
                  />
                  <div className="mt-1 text-center text-[10px] text-slate-500">{noteValue === null ? "rest" : "note"}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs text-slate-300">
        <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
          playhead: {sequencer.playhead + 1}/{sequencer.stepCount}
        </span>
        <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
          midi input: {midiInputName ?? "none"}
        </span>
        <button
          type="button"
          onClick={onResetPlayhead}
          className="rounded-lg border border-slate-500 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
        >
          Reset Playhead
        </button>
        <button
          type="button"
          onClick={onAllNotesOff}
          className="rounded-lg border border-amber-400/50 bg-amber-400/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-200 transition hover:bg-amber-400/30"
        >
          All Notes Off
        </button>
      </div>
    </section>
  );
}
