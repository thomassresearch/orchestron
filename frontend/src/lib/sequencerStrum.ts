import type { StrumDirection } from "../types";

export function normalizeStrumDirection(value: unknown): StrumDirection {
  return value === "up" || value === "down" ? value : "off";
}

export function normalizeStrumSpread(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}
