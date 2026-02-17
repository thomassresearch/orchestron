import type { PatchListItem } from "../types";

interface PatchToolbarProps {
  patchName: string;
  patchDescription: string;
  patches: PatchListItem[];
  currentPatchId?: string;
  loading: boolean;
  sessionState: string;
  onPatchNameChange: (value: string) => void;
  onPatchDescriptionChange: (value: string) => void;
  onSelectPatch: (patchId: string) => void;
  onNewPatch: () => void;
  onSavePatch: () => void;
  onCompile: () => void;
  onStart: () => void;
  onStop: () => void;
  onPanic: () => void;
}

export function PatchToolbar(props: PatchToolbarProps) {
  return (
    <section className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 shadow-glow">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <label className="flex flex-col gap-1 lg:col-span-2">
          <span className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">Patch Name</span>
          <input
            className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
            value={props.patchName}
            onChange={(event) => props.onPatchNameChange(event.target.value)}
            placeholder="Bassline Mono"
          />
        </label>

        <label className="flex flex-col gap-1 lg:col-span-2">
          <span className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">Description</span>
          <input
            className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
            value={props.patchDescription}
            onChange={(event) => props.onPatchDescriptionChange(event.target.value)}
            placeholder="Warm filter-swept lead"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">Load Patch</span>
          <select
            className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
            value={props.currentPatchId ?? ""}
            onChange={(event) => {
              if (event.target.value.length > 0) {
                props.onSelectPatch(event.target.value);
              }
            }}
          >
            <option value="">Current</option>
            {props.patches.map((patch) => (
              <option key={patch.id} value={patch.id}>
                {patch.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="rounded-lg border border-slate-500 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-200 transition hover:border-slate-300 hover:text-white"
          onClick={props.onNewPatch}
          type="button"
        >
          New
        </button>
        <button
          className="rounded-lg border border-mint/50 bg-mint/15 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-mint transition hover:bg-mint/25"
          onClick={props.onSavePatch}
          type="button"
          disabled={props.loading}
        >
          Save
        </button>
        <button
          className="rounded-lg border border-accent/50 bg-accent/15 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-accent transition hover:bg-accent/25"
          onClick={props.onCompile}
          type="button"
          disabled={props.loading}
        >
          Compile
        </button>
        <button
          className="rounded-lg border border-emerald-400/50 bg-emerald-400/20 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-400/30"
          onClick={props.onStart}
          type="button"
          disabled={props.loading}
        >
          Start
        </button>
        <button
          className="rounded-lg border border-amber-400/50 bg-amber-400/20 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-amber-200 transition hover:bg-amber-400/30"
          onClick={props.onStop}
          type="button"
          disabled={props.loading}
        >
          Stop
        </button>
        <button
          className="rounded-lg border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-rose-300 transition hover:bg-rose-500/25"
          onClick={props.onPanic}
          type="button"
          disabled={props.loading}
        >
          Panic
        </button>

        <div className="ml-auto rounded-full border border-slate-700 bg-slate-950 px-3 py-1 font-mono text-xs text-slate-300">
          state: {props.sessionState}
        </div>
      </div>
    </section>
  );
}
