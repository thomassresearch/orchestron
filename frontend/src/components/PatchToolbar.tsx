import type { PatchListItem } from "../types";

interface InstrumentTabItem {
  id: string;
  title: string;
}

interface PatchToolbarProps {
  patchName: string;
  patchDescription: string;
  patches: PatchListItem[];
  currentPatchId?: string;
  loading: boolean;
  tabs: InstrumentTabItem[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onAddTab: () => void;
  onCloseTab: (tabId: string) => void;
  onPatchNameChange: (value: string) => void;
  onPatchDescriptionChange: (value: string) => void;
  onSelectPatch: (patchId: string) => void;
  onNewPatch: () => void;
  onSavePatch: () => void;
  onCompile: () => void;
}

export function PatchToolbar(props: PatchToolbarProps) {
  return (
    <section className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-3 shadow-glow">
      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
        {props.tabs.map((tab) => {
          const isActive = tab.id === props.activeTabId;
          return (
            <div key={tab.id} className="inline-flex items-stretch rounded-lg border border-slate-600 bg-slate-950/70">
              <button
                type="button"
                onClick={() => props.onSelectTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                  isActive ? "bg-accent/30 text-accent" : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                {tab.title}
              </button>
              <button
                type="button"
                onClick={() => props.onCloseTab(tab.id)}
                className="border-l border-slate-700 px-2 text-[10px] font-semibold text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
                aria-label={`Close ${tab.title}`}
                title={`Close ${tab.title}`}
              >
                ×
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={props.onAddTab}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-accent/60 bg-accent/15 text-base leading-none text-accent transition hover:bg-accent/25"
          aria-label="Add instrument tab"
          title="Add instrument tab"
        >
          +
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 lg:col-span-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">Patch Name</span>
          <input
            className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
            value={props.patchName}
            onChange={(event) => props.onPatchNameChange(event.target.value)}
            placeholder="Bassline Mono"
          />
        </label>

        <label className="flex flex-col gap-1 lg:col-span-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">Description</span>
          <input
            className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
            value={props.patchDescription}
            onChange={(event) => props.onPatchDescriptionChange(event.target.value)}
            placeholder="Warm filter-swept lead"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">Load Patch</span>
          <select
            className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
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
          className="rounded-lg border border-slate-500 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-200 transition hover:border-slate-300 hover:text-white"
          onClick={props.onNewPatch}
          type="button"
        >
          New
        </button>
        <button
          className="rounded-lg border border-mint/50 bg-mint/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-mint transition hover:bg-mint/25"
          onClick={props.onSavePatch}
          type="button"
          disabled={props.loading}
        >
          Save
        </button>
        <button
          className="rounded-lg border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-accent transition hover:bg-accent/25"
          onClick={props.onCompile}
          type="button"
          disabled={props.loading}
        >
          Compile
        </button>
      </div>
    </section>
  );
}
