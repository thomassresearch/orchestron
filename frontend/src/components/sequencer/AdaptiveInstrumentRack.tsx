import { useMemo, type ReactNode } from "react";
import { instrumentSizeOptions, packOrdered, RACK_GAP } from "../../lib/rackLayout";
import type { RackInstrumentBindingRow } from "../../lib/rackOrdering";
import type { GuiLanguage, PatchListItem } from "../../types";
import { performanceControllerCopy } from "../../lib/performanceControllerCopy";
import { useRackGeometry } from "./useRackGeometry";

export function AdaptiveInstrumentRack({ rows, patches, language, renderCard }: {
  rows: RackInstrumentBindingRow[]; patches: Map<string, PatchListItem>; language: GuiLanguage;
  renderCard: (row: RackInstrumentBindingRow) => ReactNode;
}) {
  const copy = performanceControllerCopy(language);
  // Primitive key intentionally excludes instance values, CC assignments and runtime state.
  const contentKey = JSON.stringify([language, rows.map(({ binding }) => {
    const patch = patches.get(binding.patchId);
    return { id: binding.id, name: patch?.name, definitions: patch?.performance_controllers ?? [], notices: [
      ...(patch?.performance_controllers?.some(definition => definition.error) ? [copy.invalid] : []),
      ...(binding.performanceControllerNotice ? [copy.reconciled] : [])
    ] };
  })]);
  const { ref, width, metrics } = useRackGeometry(contentKey);
  const layout = useMemo(() => {
    if (!width) return null;
    const [, cards] = JSON.parse(contentKey) as [string, Array<Parameters<typeof instrumentSizeOptions>[0]>];
    return packOrdered(cards.map(card => instrumentSizeOptions(card, width, metrics)), width);
  }, [contentKey, width, metrics]);
  return <div ref={ref} className="flex min-w-0 flex-wrap items-start" style={{ gap: RACK_GAP }} data-adaptive-instrument-rack>
    {rows.map((row, index) => <div key={row.binding.id} className="min-w-0 max-w-full shrink-0" style={{ width: layout?.items[index].width ?? "100%", containerType: "inline-size" }}>
      {renderCard(row)}
    </div>)}
  </div>;
}
