export const PARALLEL_BATCH_FRAMES_DEFAULT = 256;
export const PARALLEL_BATCH_FRAMES_MIN = 32;
export const PARALLEL_BATCH_FRAMES_MAX = 1024;

export function normalizeParallelBatchFrames(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= PARALLEL_BATCH_FRAMES_MIN && value <= PARALLEL_BATCH_FRAMES_MAX
    ? value : PARALLEL_BATCH_FRAMES_DEFAULT;
}
