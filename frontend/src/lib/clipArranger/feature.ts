// Vite reads this at dev-server startup/build time. Saved formats stay independent.
export function isClipArrangerEnabled(): boolean {
  return import.meta.env.VITE_CLIP_ARRANGER !== "0";
}
