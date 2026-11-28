import { useRef } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { instrumentDesignCopy } from "../lib/instrumentDesignCopy";
import { PatchPicker } from "./PatchPicker";
import { INSTRUMENT_TYPES, instrumentTypeCopy } from "../lib/instrumentTypes";
import type { GuiLanguage, InstrumentType, PatchListItem } from "../types";

interface InstrumentTabItem {
  id: string;
  title: string;
}

interface PatchToolbarProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  guiLanguage: GuiLanguage;
  patchName: string;
  patchDescription: string;
  patchIsTemplate: boolean;
  patchInstrumentType: InstrumentType;
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
  onPatchTemplateChange: (value: boolean) => void;
  onPatchTypeChange: (value: InstrumentType) => void;
  onSelectPatch: (patchId: string) => void;
  onNewPatch: () => void;
  onClonePatch: () => void;
  onDeletePatch: () => void;
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
  template: string;
  templateToken: string;
  loadPatch: string;
  clonePatch: string;
  deletePatch: string;
  savePatch: string;
  compilePatch: string;
  exportCsd: string;
  exportPatch: string;
  importPatch: string;
};

export const PATCH_TOOLBAR_COPY: Record<GuiLanguage, PatchToolbarCopy> = {
  english: {
    closeTabAria: "Close tab",
    addInstrumentTab: "Add instrument tab",
    patchName: "Patch Name",
    patchNamePlaceholder: "Bassline Mono",
    description: "Description",
    descriptionPlaceholder: "Warm filter-swept lead",
    template: "Template?",
    templateToken: "TEMPLATE",
    loadPatch: "Load Patch",
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
    template: "Template?",
    templateToken: "TEMPLATE",
    loadPatch: "Patch laden",
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
    template: "Template ?",
    templateToken: "TEMPLATE",
    loadPatch: "Charger patch",
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
    template: "Template?",
    templateToken: "TEMPLATE",
    loadPatch: "Cargar patch",
    clonePatch: "Clonar",
    deletePatch: "Eliminar",
    savePatch: "Guardar",
    compilePatch: "Compilar",
    exportCsd: "Exportar CSD",
    exportPatch: "Exportar",
    importPatch: "Importar"
  }
};

const PATCH_DESCRIPTION_MAX_LENGTH = 2048;

export function PatchToolbar(props: PatchToolbarProps) {
  const copy = PATCH_TOOLBAR_COPY[props.guiLanguage];
  const typeCopy = instrumentTypeCopy(props.guiLanguage);

  const design = instrumentDesignCopy(props.guiLanguage);
  const fileMenu = useRef<HTMLDetailsElement>(null);
  const fileActions = [
    [copy.clonePatch, props.onClonePatch], [copy.importPatch, props.onImportPatch],
    [copy.exportPatch, props.onExportPatch], [copy.exportCsd, props.onExportCsd], [copy.deletePatch, props.onDeletePatch]
  ] as const;
  return (
    <section className="studio-panel patch-toolbar">
      <div className="patch-toolbar-row">
      <div className="patch-tabs">
        {props.tabs.map((tab) => {
          const isActive = tab.id === props.activeTabId;
          return (
            <div key={tab.id} className="inline-flex items-stretch rounded-lg border border-slate-600 bg-slate-950/70">
              <button
                type="button"
                aria-pressed={isActive}
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

      <div className="patch-library-actions">
        <button type="button" className="design-action" disabled={props.loading} onClick={props.onNewPatch}><Plus />{design.newInstrument}</button>
        <PatchPicker patches={props.patches} guiLanguage={props.guiLanguage} label={copy.loadPatch}
          templateToken={copy.templateToken} onSelectPatch={props.onSelectPatch} triggerClassName="design-action" />
        <details ref={fileMenu} className="patch-file" onBlur={e => {
          if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false;
        }} onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}>
          <summary className="design-action"><FolderOpen />{design.file}</summary>
          <div className="patch-file-items">
            {fileActions.map(([label, action]) => <button type="button" key={label}
              disabled={props.loading || (action === props.onDeletePatch && !props.currentPatchId)}
              onClick={() => { if (fileMenu.current) fileMenu.current.open = false; action(); }}>{label}</button>)}
          </div>
        </details>
        <button type="button" className="design-action" aria-expanded={!props.collapsed} aria-controls="instrument-patch-details"
          onClick={() => props.onCollapsedChange(!props.collapsed)}>{design.details} {props.collapsed ? "▸" : "▾"}</button>
      </div></div>
      <div id="instrument-patch-details" className="patch-metadata" hidden={props.collapsed}>
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-6">
        <div className="flex h-full flex-col gap-2 lg:col-span-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">{copy.patchName}</span>
            <input
              className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
              value={props.patchName}
              onChange={(event) => props.onPatchNameChange(event.target.value)}
              placeholder={copy.patchNamePlaceholder}
            />
          </label>

          <div className="mt-auto flex flex-wrap items-end gap-x-4 gap-y-1">
            <label className="flex h-7 items-end gap-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">{copy.template}</span>
              <input
                type="checkbox"
                checked={props.patchIsTemplate}
                onChange={(event) => props.onPatchTemplateChange(event.target.checked)}
                className="h-4 w-4 rounded border-slate-500 bg-slate-950 accent-accent"
              />
            </label>
            <label className="flex h-7 items-end gap-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">{typeCopy.type}</span>
              <select value={props.patchInstrumentType} onChange={(event) => props.onPatchTypeChange(event.target.value as InstrumentType)} className="min-w-0 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs">
                {INSTRUMENT_TYPES.map((type) => <option key={type} value={type}>{typeCopy.types[type]}</option>)}
              </select>
            </label>
          </div>
        </div>

        <label className="flex flex-col gap-1 lg:col-span-4">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">{copy.description}</span>
          <textarea
            className="h-[4.5rem] resize-none rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 font-body text-sm leading-5 text-slate-100 outline-none ring-accent/40 transition focus:ring"
            value={props.patchDescription}
            title={props.patchDescription}
            onChange={(event) =>
              props.onPatchDescriptionChange(event.target.value.slice(0, PATCH_DESCRIPTION_MAX_LENGTH))
            }
            maxLength={PATCH_DESCRIPTION_MAX_LENGTH}
            placeholder={copy.descriptionPlaceholder}
            rows={3}
          />
        </label>

      </div>
      </div>
    </section>
  );
}
