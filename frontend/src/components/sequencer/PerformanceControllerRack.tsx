import { performanceControllerCopy } from "../../lib/performanceControllerCopy";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage, PatchListItem, SequencerInstrumentBinding } from "../../types";
import { PerformanceControllerKnob } from "./PerformanceControllerKnob";

export function PerformanceControllerRack({ binding, patch, language }: {
  binding: SequencerInstrumentBinding; patch?: PatchListItem; language: GuiLanguage;
}) {
  const setValue = useAppStore((state) => state.setPerformanceControllerValue);
  const copy = performanceControllerCopy(language);
  const definitions = patch?.performance_controllers ?? [];
  if (!definitions.length && !binding.performanceControllerNotice) return null;
  return <div className="mt-3 min-w-0 border-t border-slate-600/50 pt-2">
    <div className="flex max-w-full flex-wrap items-start gap-x-3 gap-y-4" aria-label={copy.title}>
      {definitions.map((definition) => <PerformanceControllerKnob key={definition.node_id} definition={definition}
        value={binding.performanceControllerValues?.[definition.node_id] ?? definition.default} language={language}
        onChange={(value) => setValue(binding.id, definition.node_id, value)} onReset={() => setValue(binding.id, definition.node_id, null)} />)}
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
