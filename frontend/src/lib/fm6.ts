import data from "../../../backend/app/data/fm6.json";
import type { NodeInstance } from "../types";

export const FM6 = data;
export const FM6_FIELDS = Object.keys(data.fields) as Array<keyof typeof data.fields>;
export const FM6_GLOBALS = data.globals as Record<keyof typeof data.globals, [number, number, number]>;
export type Fm6Params = NodeInstance["params"];
export function fm6Voice(params: Fm6Params): Record<string, number> {
  const preset = data.presets.find(p => p.id === Number(params.ipreset ?? 0));
  return preset ? { ...preset.voice } : Object.fromEntries(Object.entries(data.default).map(([key, fallback]) =>
    [key, Number(params[key] ?? fallback)]));
}
export function fm6Custom(params: Fm6Params, changes: Record<string, number>): Fm6Params {
  return { ...params, ...fm6Voice(params), ...changes, ipreset: 0 };
}
export function fm6Ranges(): Record<string, [number, number, number]> {
  return { algorithm: [1, 8, 1], feedback: [0, 100, 0], ipreset: [0, data.presets.length, 0], ...FM6_GLOBALS,
    ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => FM6_FIELDS.map(key =>
      [`op${index + 1}_${key}`, data.fields[key]] as const)).flat()) };
}
