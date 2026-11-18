import { createContext, useContext } from "react";

export const ClipEditingContext = createContext(false);
export const LivePadEditorContext = createContext(false);

/** Both single-pattern surfaces omit rack and device management controls. */
export function useSinglePatternEditor() {
  const clip = useContext(ClipEditingContext);
  const live = useContext(LivePadEditorContext);
  return clip || live;
}
