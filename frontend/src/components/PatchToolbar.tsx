import type { GuiLanguage, PatchListItem } from "../types";

interface InstrumentTabItem {
  id: string;
  title: string;
}

interface PatchToolbarProps {
  guiLanguage: GuiLanguage;
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
  onClonePatch: () => void;
  onDeletePatch: () => void;
  onSavePatch: () => void;
  onCompile: () => void;
  onExportCsd: () => void;
  onExportPatch: () => void;
  onImportPatch: () => void;
}

type PatchToolbarCopy = {
  closeTabAria: string;
  addInstrumentTab: string;
  patchName: string;
  patchNamePlaceholder: string;
  description: string;
  descriptionPlaceholder: string;
  loadPatch: string;
  currentPatch: string;
  newPatch: string;
  clonePatch: string;
  deletePatch: string;
  savePatch: string;
  compilePatch: string;
  exportCsd: string;
  exportPatch: string;
  importPatch: string;
};

const PATCH_TOOLBAR_COPY: Record<GuiLanguage, PatchToolbarCopy> = {
  english: {
    closeTabAria: "Close tab",
    addInstrumentTab: "Add instrument tab",
    patchName: "Patch Name",
    patchNamePlaceholder: "Bassline Mono",
    description: "Description",
    descriptionPlaceholder: "Warm filter-swept lead",
    loadPatch: "Load Patch",
    currentPatch: "Current",
    newPatch: "New",
    clonePatch: "Clone",
    deletePatch: "Delete",
    savePatch: "Save",
    compilePatch: "Compile",
    exportCsd: "Export CSD",
    exportPatch: "Export",
    importPatch: "Import"
  },
  german: {
    closeTabAria: "Tab schliessen",
    addInstrumentTab: "Instrument-Tab hinzufuegen",
    patchName: "Patch-Name",
    patchNamePlaceholder: "Bassline Mono",
    description: "Beschreibung",
    descriptionPlaceholder: "Warmer Filter-Sweep-Lead",
    loadPatch: "Patch laden",
    currentPatch: "Aktuell",
    newPatch: "Neu",
    clonePatch: "Klonen",
    deletePatch: "Loeschen",
    savePatch: "Speichern",
    compilePatch: "Kompilieren",
    exportCsd: "CSD exportieren",
    exportPatch: "Exportieren",
    importPatch: "Importieren"
  },
  french: {
    closeTabAria: "Fermer onglet",
    addInstrumentTab: "Ajouter onglet instrument",
    patchName: "Nom du patch",
    patchNamePlaceholder: "Bassline Mono",
    description: "Description",
    descriptionPlaceholder: "Lead chaud avec sweep de filtre",
    loadPatch: "Charger patch",
    currentPatch: "Actuel",
    newPatch: "Nouveau",
    clonePatch: "Cloner",
    deletePatch: "Supprimer",
    savePatch: "Enregistrer",
    compilePatch: "Compiler",
    exportCsd: "Exporter CSD",
    exportPatch: "Exporter",
    importPatch: "Importer"
  },
  spanish: {
    closeTabAria: "Cerrar pestana",
    addInstrumentTab: "Agregar pestana de instrumento",
    patchName: "Nombre del patch",
    patchNamePlaceholder: "Bassline Mono",
    description: "Descripcion",
    descriptionPlaceholder: "Lead calido con barrido de filtro",
    loadPatch: "Cargar patch",
    currentPatch: "Actual",
    newPatch: "Nuevo",
    clonePatch: "Clonar",
    deletePatch: "Eliminar",
    savePatch: "Guardar",
    compilePatch: "Compilar",
    exportCsd: "Exportar CSD",
    exportPatch: "Exportar",
    importPatch: "Importar"
  }
};

export function PatchToolbar(props: PatchToolbarProps) {
  const copy = PATCH_TOOLBAR_COPY[props.guiLanguage];

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
                aria-label={`${copy.closeTabAria}: ${tab.title}`}
                title={`${copy.closeTabAria}: ${tab.title}`}
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
          aria-label={copy.addInstrumentTab}
          title={copy.addInstrumentTab}
        >
          +
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 lg:col-span-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">{copy.patchName}</span>
          <input
            className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
            value={props.patchName}
            onChange={(event) => props.onPatchNameChange(event.target.value)}
            placeholder={copy.patchNamePlaceholder}
          />
        </label>

        <label className="flex flex-col gap-1 lg:col-span-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">{copy.description}</span>
          <input
            className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
            value={props.patchDescription}
            onChange={(event) => props.onPatchDescriptionChange(event.target.value)}
            placeholder={copy.descriptionPlaceholder}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">{copy.loadPatch}</span>
          <select
            className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
            value={props.currentPatchId ?? ""}
            onChange={(event) => {
              if (event.target.value.length > 0) {
                props.onSelectPatch(event.target.value);
              }
            }}
          >
            <option value="">{copy.currentPatch}</option>
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
          {copy.newPatch}
        </button>
        <button
          className="rounded-lg border border-slate-500 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-200 transition hover:border-slate-300 hover:text-white"
          onClick={props.onClonePatch}
          type="button"
          disabled={props.loading}
        >
          {copy.clonePatch}
        </button>
        <button
          className="rounded-lg border border-rose-500/55 bg-rose-500/12 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={props.onDeletePatch}
          type="button"
          disabled={props.loading || !props.currentPatchId}
        >
          {copy.deletePatch}
        </button>
        <button
          className="rounded-lg border border-mint/50 bg-mint/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-mint transition hover:bg-mint/25"
          onClick={props.onSavePatch}
          type="button"
          disabled={props.loading}
        >
          {copy.savePatch}
        </button>
        <button
          className="rounded-lg border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-accent transition hover:bg-accent/25"
          onClick={props.onCompile}
          type="button"
          disabled={props.loading}
        >
          {copy.compilePatch}
        </button>
        <button
          className="rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-200 transition hover:bg-emerald-500/25"
          onClick={props.onExportPatch}
          type="button"
          disabled={props.loading}
        >
          {copy.exportPatch}
        </button>
        <button
          className="rounded-lg border border-teal-500/50 bg-teal-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-teal-200 transition hover:bg-teal-500/25"
          onClick={props.onImportPatch}
          type="button"
          disabled={props.loading}
        >
          {copy.importPatch}
        </button>
        <button
          className="rounded-lg border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-cyan-200 transition hover:bg-cyan-500/25"
          onClick={props.onExportCsd}
          type="button"
          disabled={props.loading}
        >
          {copy.exportCsd}
        </button>
      </div>
    </section>
  );
}
