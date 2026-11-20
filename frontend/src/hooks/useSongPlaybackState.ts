import { useMemo } from "react";
import { songDraftPlayback } from "../lib/clipArranger/songDrafts";
import { useAppStore } from "../store/useAppStore";

/** Resolve audible clip names and scales without recompiling on playhead updates. */
export function useSongPlaybackState() {
  const authored = useAppStore(s => s.sequencer);
  const drafts = useAppStore(s => s.clipDrafts);
  return useMemo(() => {
    try {
      return songDraftPlayback(authored, drafts);
    } catch {
      // Preparation reports an invalid draft. Keep the authored tracks available in the UI.
      return authored;
    }
  }, [authored, drafts]);
}
