import { useMemo, useState } from "react";

import type { OpcodeSpec } from "../types";

interface OpcodeCatalogProps {
  opcodes: OpcodeSpec[];
  onAddOpcode: (opcode: OpcodeSpec) => void;
}

export function OpcodeCatalog({ opcodes, onAddOpcode }: OpcodeCatalogProps) {
  const [query, setQuery] = useState("");
  const iconBase =
    (import.meta.env.VITE_BACKEND_BASE as string | undefined) ??
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) {
      return opcodes;
    }

    return opcodes.filter((opcode) => {
      return (
        opcode.name.toLowerCase().includes(q) ||
        opcode.category.toLowerCase().includes(q) ||
        opcode.description.toLowerCase().includes(q) ||
        opcode.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [opcodes, query]);

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-700/70 bg-slate-900/75 p-3">
      <h2 className="font-display text-sm uppercase tracking-[0.24em] text-slate-300">Opcode Catalog</h2>
      <input
        className="mt-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
        placeholder="Search opcode"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-scroll pr-1">
        {filtered.map((opcode) => (
          <button
            key={opcode.name}
            type="button"
            onClick={() => onAddOpcode(opcode)}
            className="group flex w-full items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/80 p-2 text-left transition hover:border-accent/70 hover:bg-slate-900"
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
            <span className="text-[10px] font-semibold uppercase tracking-wider text-accent opacity-0 transition group-hover:opacity-100">Add</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
