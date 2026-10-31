import { performanceControllerCopy } from "../../lib/performanceControllerCopy";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage, PatchListItem, SequencerInstrumentBinding } from "../../types";
import { PerformanceControllerKnob } from "./PerformanceControllerKnob";
import { PerformanceControllerDiscrete } from "./PerformanceControllerDiscrete";

export function PerformanceControllerRack({ binding, patch, language }: {
  binding: SequencerInstrumentBinding; patch?: PatchListItem; language: GuiLanguage;
}) {
  const setCC = useAppStore((state) => state.setPerformanceControllerMidiCC);
  const setValue = useAppStore((state) => state.setPerformanceControllerValue);
  const copy = performanceControllerCopy(language);
  const definitions = patch?.performance_controllers ?? [];
  if (!definitions.length && !binding.performanceControllerNotice) return null;
  return <div className="mt-3 min-w-0 border-t border-slate-600/50 pt-2">
    <div className="flex max-w-full flex-wrap items-stretch gap-x-2 gap-y-4" aria-label={copy.title}>
      {definitions.map((definition) => {
        const Control = definition.controller_type === "integer" || definition.controller_type === "bool" ? PerformanceControllerDiscrete : PerformanceControllerKnob;
        const disabled = !!definition.error || !!patch?.always_on || binding.midiChannel === 0;
        return <div key={definition.node_id} className="flex w-20 flex-col justify-between gap-2"><Control definition={definition} editorOwner={`binding:${binding.id}`}
        value={binding.performanceControllerValues?.[definition.node_id] ?? definition.default} language={language}
        onChange={(value) => setValue(binding.id, definition.node_id, value)} onReset={() => setValue(binding.id, definition.node_id, null)} />
          <label className="flex flex-col gap-1 text-[10px] text-slate-400" title={disabled ? (definition.error ? copy.invalid : copy.midiUnavailable) : copy.midiHelp}>
            <span>{copy.midiCC}</span>
            <select aria-label={`${definition.label} · ${copy.midiCC}`} disabled={disabled}
              className="w-full rounded border border-slate-600 bg-slate-950 px-1 py-1 text-xs text-cyan-100 disabled:opacity-40"
              value={binding.performanceControllerMidiCCs?.[definition.node_id] ?? ""}
              onChange={event => setCC(binding.id, definition.node_id, event.target.value === "" ? null : Number(event.target.value))}>
              <option value="">{copy.off}</option>
              {Array.from({ length: 50 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
            {disabled && <span>{definition.error ? copy.invalid : copy.midiUnavailable}</span>}
          </label>
        </div>;
      })}
    </div>
    {definitions.some((definition) => definition.error) && <p role="alert" className="mt-2 text-xs text-rose-300">{copy.invalid}</p>}
    {binding.performanceControllerNotice && <p role="status" className="mt-2 text-xs text-amber-200">{copy.reconciled}</p>}
    {patch?.always_on && definitions.length > 0 && <p className="mt-2 text-[10px] text-slate-400">{copy.continuous}</p>}
  </div>;
}

export function PerformanceControllerSyncStatus({ language }: { language: GuiLanguage }) {
  const error = useAppStore((state) => state.performanceControllerSyncError);
  const flush = useAppStore((state) => state.flushPerformanceControllers);
  const copy = performanceControllerCopy(language);
  if (!error) return null;
  return <div role="alert" className="mt-2 text-xs text-rose-300">{copy.sync}: {error}
    <button type="button" className="ml-2 rounded border border-rose-400 px-2 py-1" onClick={() => void flush().catch(() => undefined)}>{copy.retry}</button>
  </div>;
}
