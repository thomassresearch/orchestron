import { QUARTER_TICKS } from "./model";

export type GridLine = { tick: number; level: "division" | "beat" | "bar" | "phrase"; label?: string };

/** All levels share the song origin. Only enumerate the visible interval. */
export function timelineGrid(beatTicks: number, beatsPerBar: number, zoom: number, from: number, to: number, subdivisions = 4): GridLine[] {
  const pixels = zoom / QUARTER_TICKS;
  const bar = beatTicks * beatsPerBar;
  let phrase = bar * 4;
  let stride = bar;
  while (stride * pixels < 12) stride *= 4;
  if (beatTicks * pixels >= 12) {
    stride = beatTicks;
    for (const parts of [subdivisions, 2]) {
      if (beatTicks % parts === 0 && beatTicks / parts * pixels >= 12 && subdivisions % parts === 0) {
        stride = beatTicks / parts;
        break;
      }
    }
  }
  while (phrase < stride * 4 && stride >= bar) phrase *= 4;
  const labelWidth = Math.max(38, String(Math.floor(to / bar) + 1).length * 7 + 24);
  let labelStride = bar;
  while (labelStride * pixels < labelWidth) labelStride *= 4;
  const lines: GridLine[] = [];
  for (let tick = Math.max(0, Math.ceil(from / stride)) * stride; tick <= to; tick += stride) {
    const level = tick % phrase === 0 ? "phrase" : tick % bar === 0 ? "bar" : tick % beatTicks === 0 ? "beat" : "division";
    const barNumber = Math.floor(tick / bar) + 1;
    const label = tick % labelStride === 0 ? barNumber + ".1" : level === "beat" && beatTicks * pixels >= labelWidth
      ? barNumber + "." + (1 + tick % bar / beatTicks) : undefined;
    lines.push({ tick, level, label });
  }
  return lines;
}
