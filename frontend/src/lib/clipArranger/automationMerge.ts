import { create } from "zustand";
import type { AutomationMergeConflict } from "./automation";
export const useAutomationMerge = create<{ conflict: AutomationMergeConflict | null; resolve: ((id: string | null) => void) | null }>(() => ({ conflict: null, resolve: null }));
export function chooseAutomationMerge(conflict: AutomationMergeConflict): Promise<string | null> {
  useAutomationMerge.getState().resolve?.(null);
  return new Promise(resolve => useAutomationMerge.setState({ conflict, resolve: id => { useAutomationMerge.setState({ conflict: null, resolve: null }); resolve(id); } }));
}
