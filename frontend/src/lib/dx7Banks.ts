import type { Dx7Banks } from "../types";

export function readDx7Banks(value: unknown): {dx7Banks?: Dx7Banks} {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid DX7 banks.");
  const banks: Dx7Banks = {};
  for (const [slot, bank] of Object.entries(value)) {
    if (!/^(?:[1-9]|1[0-6])$/.test(slot) || !bank || typeof bank.name !== "string" ||
        !bank.name.length || bank.name.length > 255 || typeof bank.data !== "string" || bank.data.length !== 5472) {
      throw new Error("Invalid DX7 cartridge.");
    }
    const bytes = atob(bank.data);
    if (bytes.length !== 4104 || bytes.charCodeAt(0) !== 240 || bytes.charCodeAt(1) !== 67 ||
        bytes.charCodeAt(2) > 15 || bytes.slice(3, 6) !== "\x09\x20\x00" || bytes.charCodeAt(4103) !== 247 ||
        [...bytes.slice(6, 4103)].reduce((sum, byte) => sum + byte.charCodeAt(0), 0) % 128) {
      throw new Error("Invalid DX7 cartridge.");
    }
    banks[slot] = {name: bank.name, data: bank.data};
  }
  return Object.keys(banks).length ? {dx7Banks: banks} : {};
}

export function cartridgeNames(data: string): string[] {
  const raw = atob(data);
  return Array.from({length: 32}, (_, i) => raw.slice(124 + i * 128, 134 + i * 128).replace(/[^ -~]/g, " ").trim());
}

export function sameDx7Banks(a: Dx7Banks = {}, b: Dx7Banks = {}) {
  return Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([slot, bank]) => b[slot]?.name === bank.name && b[slot]?.data === bank.data);
}
