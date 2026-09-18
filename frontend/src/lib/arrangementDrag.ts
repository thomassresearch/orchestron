import type { PadLoopPatternItem } from "../types";

let drag: { trackId: string; item: PadLoopPatternItem } | null = null;
export const currentArrangementDrag = () => drag;
export const beginArrangementDrag = (trackId: string, item: PadLoopPatternItem) => { drag = { trackId, item }; };
export const endArrangementDrag = () => { drag = null; };
export const ARRANGEMENT_ITEM_MIME = "application/x-orchestron-pattern-reference";
