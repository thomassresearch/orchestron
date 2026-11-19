import { useCallback, type KeyboardEvent, type MouseEvent } from "react";
import { MASTER } from "../../lib/audioRouting";
import { usePerformanceEditorState } from "./PerformanceEditorState";

// The last selected instance owns single-target actions such as Samples and Routing.
export function useRackSelection() {
  const [ids, setIds] = usePerformanceEditorState<string[]>("mixer", "selection", []);
  const select = useCallback((id: string, extend = false) => {
    setIds(previous => {
      if (!id) return [];
      if (!extend || id === MASTER || previous.includes(MASTER)) return [id];
      return previous.includes(id) ? previous.filter(other => other !== id) : [...previous, id];
    });
  }, [setIds]);
  const picker = (id: string, multiple = true) => ({
    "data-rack-choice": id,
    "aria-pressed": ids.includes(id),
    onClick: (event: MouseEvent<HTMLButtonElement>) => select(id, multiple && event.shiftKey),
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (multiple && event.shiftKey && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        if (!event.repeat) select(id, true);
      }
    }
  });
  return { ids, primary: ids[ids.length - 1] ?? "", select, picker };
}
