import { stereoOpcodeLabel } from "../lib/stereoCatalog";
import { audioCopy } from "../lib/audioCopy";
import { controlFlowCopy } from "../lib/controlFlowCopy";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { instrumentDesignCopy } from "../lib/instrumentDesignCopy";

import { documentationUiCopy } from "../lib/documentationUi";
import { setDraggedOpcode, clearDraggedOpcode } from "../lib/opcodeDragDrop";
import type { GuiLanguage, OpcodeSpec } from "../types";

interface OpcodeCatalogProps {
  guiLanguage: GuiLanguage;
  opcodes: OpcodeSpec[];
  onAddOpcode: (opcode: OpcodeSpec) => void;
  drawerOpen?: boolean;
  onCloseDrawer?: () => void;
  onOpcodeHelpRequest?: (opcodeName: string) => void;
}

const OPCODE_CATALOG_COPY: Record<GuiLanguage, { title: string; searchPlaceholder: string }> = {
  english: {
    title: "Opcode Catalog",
    searchPlaceholder: "Search opcode"
  },
  german: {
    title: "Opcode-Katalog",
    searchPlaceholder: "Opcode suchen"
  },
  french: {
    title: "Catalogue Opcode",
    searchPlaceholder: "Rechercher opcode"
  },
  spanish: {
    title: "Catalogo de Opcode",
    searchPlaceholder: "Buscar opcode"
  }
};

export function OpcodeCatalog({ guiLanguage, opcodes, onAddOpcode, onOpcodeHelpRequest, drawerOpen, onCloseDrawer }: OpcodeCatalogProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const design = instrumentDesignCopy(guiLanguage);
  useEffect(() => { if (drawerOpen) search.current?.focus(); }, [drawerOpen]);
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

    const aliases: Record<string, string> = { outs: "speakers audio output lautsprecher audioausgang haut-parleurs sortie audio altavoces salida audio", inleta: "audio input stereo bus audioeingang entrée audio entrada audio", outleta: "send bus stereo output senden sortie audio envío salida audio" };
    return opcodes.filter((opcode) => [opcode.name, opcode.category, stereoOpcodeLabel(opcode.name, guiLanguage), opcode.description, ...opcode.tags, aliases[opcode.name] ?? ""].join(" ").toLowerCase().includes(q));
  }, [opcodes, query, guiLanguage]);

  const index = Math.min(activeIndex, filtered.length - 1);
  const active = filtered[index];
  const add = (opcode: OpcodeSpec) => { onAddOpcode(opcode); if (drawerOpen) onCloseDrawer?.(); };
  const move = (next: number) => {
    const row = Math.max(0, Math.min(filtered.length - 1, next));
    setActiveIndex(row);
    results.current?.children[row]?.scrollIntoView?.({ block: "nearest" });
  };
  return (
    <aside className="studio-panel opcode-catalog" onKeyDown={e => {
      if (e.key === "Escape" && drawerOpen) { e.preventDefault(); onCloseDrawer?.(); }
    }}>
      <div className="catalog-heading"><h2>{copy.title}</h2>
        <button className="catalog-close" type="button" aria-label={design.close} onClick={onCloseDrawer}><X size={16} /></button>
      </div>
      <div className="catalog-search"><Search size={15} aria-hidden="true" />
        <input ref={search} role="combobox" aria-label={copy.searchPlaceholder} aria-controls={listId} aria-expanded="true"
          aria-autocomplete="list" aria-activedescendant={active ? listId + "-" + index : undefined}
          placeholder={copy.searchPlaceholder} value={query}
          onChange={e => { setQuery(e.target.value); setActiveIndex(0); if (results.current) results.current.scrollTop = 0; }}
          onKeyDown={e => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault(); move(index + (e.key === "ArrowDown" ? 1 : -1));
            } else if (e.key === "Enter" && active && !e.nativeEvent.isComposing) {
              e.preventDefault(); add(active);
            }
          }} />
      </div>
      <div ref={results} id={listId} role="listbox" aria-label={design.results} className="catalog-results">
        {filtered.map((opcode, i) => (
          <div key={opcode.name} role="option" id={listId + "-" + i} aria-selected={i === index}
            onPointerEnter={() => setActiveIndex(i)} onClick={() => add(opcode)}
            draggable onDragEnd={clearDraggedOpcode}
            onDragStart={event => setDraggedOpcode(event.dataTransfer, opcode.name)}
            className="catalog-option">
            <img src={new URL(opcode.icon, iconBase).toString()} alt="" />
            <span><strong>{opcode.name === "outs" ? audioCopy(guiLanguage)("direct") + " · outs" : stereoOpcodeLabel(opcode.name, guiLanguage)}</strong>
              <small>{opcode.category === "control_flow" ? controlFlowCopy(guiLanguage)("title") : opcode.category}</small></span>
            {onOpcodeHelpRequest && <button type="button" tabIndex={-1} className="catalog-row-help"
              title={documentationCopy.showDocumentation + " · " + opcode.name} aria-label={documentationCopy.showDocumentation + " · " + opcode.name}
              onClick={e => { e.stopPropagation(); onOpcodeHelpRequest(opcode.name); }}>?</button>}
          </div>
        ))}
      </div>
      {!active && <p className="catalog-empty" role="status">{design.noMatches}</p>}
      {active && onOpcodeHelpRequest && <button type="button" className="catalog-help"
        onClick={() => onOpcodeHelpRequest(active.name)}><span aria-hidden="true">?</span>
        {documentationCopy.help} · {stereoOpcodeLabel(active.name, guiLanguage)}</button>}
    </aside>
  );
}
