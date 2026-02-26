import { useMemo, useState } from "react";

import { documentationUiCopy } from "../lib/documentation";
import { setDraggedOpcode } from "../lib/opcodeDragDrop";
import type { GuiLanguage, OpcodeSpec } from "../types";

interface OpcodeCatalogProps {
  guiLanguage: GuiLanguage;
  opcodes: OpcodeSpec[];
  onAddOpcode: (opcode: OpcodeSpec) => void;
  onOpcodeHelpRequest?: (opcodeName: string) => void;
}

const OPCODE_CATALOG_COPY: Record<GuiLanguage, { title: string; searchPlaceholder: string; add: string }> = {
  english: {
    title: "Opcode Catalog",
    searchPlaceholder: "Search opcode",
    add: "Add"
  },
  german: {
    title: "Opcode-Katalog",
    searchPlaceholder: "Opcode suchen",
    add: "Add"
  },
  french: {
    title: "Catalogue Opcode",
    searchPlaceholder: "Rechercher opcode",
    add: "Ajouter"
  },
  spanish: {
    title: "Catalogo de Opcode",
    searchPlaceholder: "Buscar opcode",
    add: "Agregar"
  }
};

export function OpcodeCatalog({ guiLanguage, opcodes, onAddOpcode, onOpcodeHelpRequest }: OpcodeCatalogProps) {
  const [query, setQuery] = useState("");
  const copy = OPCODE_CATALOG_COPY[guiLanguage];
  const documentationCopy = documentationUiCopy(guiLanguage);
  const iconBase =
    (import.meta.env.VITE_BACKEND_BASE as string | undefined) ??
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) {
      return opcodes;
    }

    return opcodes.filter((opcode) => opcode.name.toLowerCase().includes(q));
  }, [opcodes, query]);

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-700/70 bg-slate-900/75 p-3">
      <h2 className="font-display text-sm uppercase tracking-[0.24em] text-slate-300">{copy.title}</h2>
      <input
        className="mt-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
        placeholder={copy.searchPlaceholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-scroll pr-1">
        {filtered.map((opcode) => (
          <div key={opcode.name} className="relative">
            <button
              type="button"
              onClick={() => onAddOpcode(opcode)}
              draggable
              onDragStart={(event) => {
                setDraggedOpcode(event.dataTransfer, opcode.name);
              }}
              className="group flex w-full items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/80 p-2 pr-9 text-left transition hover:border-accent/70 hover:bg-slate-900"
            >
              <img
                src={new URL(opcode.icon, iconBase).toString()}
                alt={opcode.name}
                className="h-8 w-8 rounded-md border border-slate-700 bg-slate-800"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs text-slate-200">{opcode.name}</div>
                <div className="truncate text-[11px] uppercase tracking-[0.16em] text-slate-500">{opcode.category}</div>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-accent opacity-0 transition group-hover:opacity-100">
                {copy.add}
              </span>
            </button>
            {onOpcodeHelpRequest ? (
              <button
                type="button"
                aria-label={`${documentationCopy.showDocumentation}: ${opcode.name}`}
                title={`${documentationCopy.showDocumentation}: ${opcode.name}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpcodeHelpRequest(opcode.name);
                }}
                className="absolute right-1.5 top-1.5 z-10 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/25 bg-black/45 text-[10px] font-bold leading-none text-white transition hover:border-accent hover:text-accent"
              >
                ?
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  );
}
