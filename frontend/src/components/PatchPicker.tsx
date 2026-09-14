import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { INSTRUMENT_TYPES, instrumentTypeCopy } from "../lib/instrumentTypes";
import type { GuiLanguage, InstrumentType, PatchListItem } from "../types";

interface PatchPickerProps {
  patches: PatchListItem[];
  guiLanguage: GuiLanguage;
  label: string;
  ariaLabel?: string;
  templateToken?: string;
  disabled?: boolean;
  align?: "left" | "right";
  triggerClassName?: string;
  onSelectPatch: (patchId: string) => void;
}

export function PatchPicker({
  patches, guiLanguage, label, ariaLabel, templateToken = "", disabled = false, align = "right",
  triggerClassName = "rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 text-sm text-slate-100",
  onSelectPatch
}: PatchPickerProps) {
  const copy = instrumentTypeCopy(guiLanguage);
  const popupId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<InstrumentType>>(new Set());
  const search = query.trim().length > 3 ? debouncedQuery : "";

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
    setExpanded(new Set());
    if (restoreFocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (disabled) close(false);
  }, [disabled, close]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open, close]);

  useEffect(() => {
    const normalized = query.trim().toLowerCase();
    if (!open || normalized.length <= 3) return;
    const timer = window.setTimeout(() => setDebouncedQuery(normalized), 500);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  const groups = useMemo(() => {
    const locale = { english: "en", german: "de", french: "fr", spanish: "es" }[guiLanguage];
    const matching = patches.filter((patch) => !search ||
      patch.name.toLowerCase().includes(search) || patch.description.toLowerCase().includes(search));
    return INSTRUMENT_TYPES.map((type) => ({
      type,
      patches: matching.filter((patch) => patch.instrument_type === type)
        .sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: "base" }) || a.id.localeCompare(b.id))
    })).filter((group) => group.patches.length > 0);
  }, [patches, guiLanguage, search]);

  const select = (patchId: string) => {
    if (disabled) return;
    close();
    onSelectPatch(patchId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Enter" && event.target === input.current && search && groups[0]) {
      event.preventDefault();
      select(groups[0].patches[0].id);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-picker-item]:not(:disabled)") ?? []);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = current < 0 ? (event.key === "ArrowDown" ? 0 : items.length - 1)
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  return (
    <div ref={root} className="relative min-w-0">
      <button ref={trigger} type="button" aria-label={ariaLabel} title={label} disabled={disabled}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popupId : undefined}
        onClick={() => open ? close() : setOpen(true)}
        className={`flex w-full items-center justify-between gap-2 outline-none focus-visible:ring focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:text-slate-500 ${triggerClassName}`}>
        <span className="truncate">{label}</span><span aria-hidden="true" className="shrink-0">▾</span>
      </button>
      {open && (
        <div id={popupId} role="dialog" aria-label={ariaLabel ?? label} onKeyDown={onKeyDown}
          className={`absolute ${align === "left" ? "left-0" : "right-0"} top-full z-50 mt-2 w-[min(24rem,calc(100vw-3rem))] rounded-xl border border-slate-600 bg-slate-950 p-3 shadow-xl`}>
          <input ref={input} type="search" aria-label={copy.search} aria-describedby={`${popupId}-guidance`}
            placeholder={copy.search} value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (event.target.value.trim().length <= 3) setDebouncedQuery("");
            }}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring focus:ring-accent/40" />
          <p id={`${popupId}-guidance`} className="mb-2 mt-1.5 text-xs text-slate-400">{copy.guidance}</p>
          <div className="max-h-72 overflow-y-auto">
            {!groups.length && <p role="status" className="px-2 py-4 text-sm text-slate-400">{search ? copy.noMatches : copy.empty}</p>}
            {groups.map((group) => {
              const isExpanded = Boolean(search) || expanded.has(group.type);
              return (
                <div key={group.type}>
                  <button type="button" data-picker-item aria-expanded={isExpanded} aria-controls={`${popupId}-${group.type}`}
                    disabled={Boolean(search)}
                    onClick={() => setExpanded((previous) => {
                      const next = new Set(previous);
                      if (next.has(group.type)) next.delete(group.type); else next.add(group.type);
                      return next;
                    })}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold text-slate-300 outline-none enabled:hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-accent">
                    <span aria-hidden="true">{isExpanded ? "▾" : "▸"}</span>
                    {copy.types[group.type]} <span className="ml-auto text-slate-400">{group.patches.length}</span>
                  </button>
                  <ul id={`${popupId}-${group.type}`} hidden={!isExpanded}>
                    {isExpanded && group.patches.map((patch) => (
                      <li key={patch.id}>
                        <button type="button" data-picker-item aria-label={`${patch.name}${patch.is_template ? ` ${templateToken}` : ""}`} onClick={() => select(patch.id)} title={patch.description || undefined}
                          className="w-full rounded px-3 py-2 text-left text-sm text-slate-100 outline-none hover:bg-slate-800 focus-visible:bg-slate-800 focus-visible:ring-2 focus-visible:ring-accent">
                          {patch.name}{patch.is_template && <span className="ml-2 text-[10px] text-accent">{` ${templateToken}`}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
