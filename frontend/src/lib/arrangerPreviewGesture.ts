/** Cancel local hold timers as well as previews already submitted to the runtime. */
export const ARRANGER_PREVIEW_CANCEL = "orchestron:cancel-arranger-preview";
export function cancelArrangerPreviewGestures() {
  window.dispatchEvent(new Event(ARRANGER_PREVIEW_CANCEL));
}
