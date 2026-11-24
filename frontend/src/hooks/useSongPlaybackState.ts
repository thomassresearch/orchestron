import { useMemo } from "react";
import { arrangementPlayback } from "../store/arrangementEdits";
import { useArrangementEdits } from "../lib/clipArranger/editSession";
import { useStructureDraft } from "../lib/clipArranger/structureStore";
import { useAppStore } from "../store/useAppStore";

/** Resolve audible clip names and scales without recompiling on playhead updates. */
export function useSongPlaybackState() {
  const authored = useAppStore(s => s.sequencer);
  const working = useArrangementEdits(s => s.session?.model);
  const drafts = useAppStore(s => s.clipDrafts);
  const structure = useStructureDraft(s => s.draft);
  return useMemo(() => {
    try {
      return arrangementPlayback(authored, drafts, null, structure).state;
    } catch {
      // Preparation reports an invalid draft. Keep the authored tracks available in the UI.
      return authored;
    }
  }, [authored, drafts, structure, working]);
}
