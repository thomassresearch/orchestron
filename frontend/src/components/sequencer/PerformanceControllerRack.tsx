import { useMemo } from "react";
import { controllerGroupGrid, groupControllers, layoutControllerGroups, RACK_GAP } from "../../lib/rackLayout";
import { useRackGeometry } from "./useRackGeometry";
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
  const contentKey = JSON.stringify([language, definitions, !!patch?.always_on]);
  const { ref, width, metrics } = useRackGeometry(contentKey);
  const groups = useMemo(() => groupControllers((JSON.parse(contentKey) as [string, typeof definitions])[1]), [contentKey]);
  const layout = useMemo(() => width ? layoutControllerGroups(groups, width, metrics) : null, [groups, width, metrics]);
  const grid = useMemo(() => layout ? controllerGroupGrid(layout) : null, [layout]);
  if (!definitions.length && !binding.performanceControllerNotice) return null;
  return <div className="mt-3 min-w-0 border-t border-slate-600/50 pt-2">
    <div ref={ref} className="grid min-w-0 max-w-full items-start" style={{ gridTemplateColumns: grid?.columns, rowGap: RACK_GAP }} aria-label={copy.title}>
      {groups.map((group, index) => {
        const Group = group.name ? "fieldset" : "div";
        return <Group key={group.name} data-controller-group={group.name} className={group.name ? "m-0 min-w-0 max-w-full shrink-0 rounded border border-slate-500/70 px-2 pb-2" : "min-w-0 max-w-full shrink-0"}
          style={{ width: layout?.items[index].width ?? "100%", ...grid?.items[index] }}>
          {group.name && <legend className="max-w-full break-words px-1 text-xs text-slate-300 [overflow-wrap:anywhere]">{group.name}</legend>}
          <div data-controller-grid className="grid items-stretch gap-x-2 gap-y-4" style={{ gridTemplateColumns: `repeat(${layout?.items[index].columns ?? 1}, ${metrics.controlWidth ?? 80}px)` }}>
            {group.controllers.map((definition) => {
              const Control = definition.controller_type === "integer" || definition.controller_type === "bool" ? PerformanceControllerDiscrete : PerformanceControllerKnob;
              const disabled = !!definition.error || !!patch?.always_on || binding.midiChannel === 0;
              return <div key={definition.node_id} data-rack-controller-tile style={{ minHeight: metrics.controlHeight }} className="flex w-20 flex-none flex-col gap-2"><Control definition={definition} editorOwner={`binding:${binding.id}`}
              value={binding.performanceControllerValues?.[definition.node_id] ?? definition.default} language={language}
              onChange={(value) => setValue(binding.id, definition.node_id, value)} onReset={() => setValue(binding.id, definition.node_id, null)} />
                <label data-rack-controller-footer className="mt-auto flex flex-col gap-1 text-[10px] text-slate-400" title={disabled ? (definition.error ? copy.invalid : copy.midiUnavailable) : copy.midiHelp}>
                  {patch?.always_on && !definition.error && <span title={definition.update_mode === "mixed" ? copy.mixedHelp : copy.continuous}
                    className={definition.update_mode === "live" ? "text-emerald-300" : "text-amber-200"}>
                    {definition.update_mode === "live" ? copy.live : definition.update_mode === "unused" ? copy.unused : copy.restart}
                  </span>}
                  <span>{copy.midiCC}</span>
                  {disabled && <span>{definition.error ? copy.invalid : copy.midiUnavailable}</span>}
                  <select aria-label={`${definition.label} · ${copy.midiCC}`} disabled={disabled}
                    className="w-full rounded border border-slate-600 bg-slate-950 px-1 py-1 text-xs text-cyan-100 disabled:opacity-40"
                    value={binding.performanceControllerMidiCCs?.[definition.node_id] ?? ""}
                    onChange={event => setCC(binding.id, definition.node_id, event.target.value === "" ? null : Number(event.target.value))}>
                    <option value="">{copy.off}</option>
                    {Array.from({ length: 50 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                  </select>
                </label>
              </div>;
            })}
          </div>
        </Group>;
      })}
    </div>
    {definitions.some((definition) => definition.error) && <p role="alert" className="mt-2 text-xs text-rose-300">{copy.invalid}</p>}
    {binding.performanceControllerNotice && <p role="status" className="mt-2 text-xs text-amber-200">{copy.reconciled}</p>}
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
