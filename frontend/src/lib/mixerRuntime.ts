import type { MixerResponse, MixerState } from "../types";
export type MeterValue = { peakL: number; peakR: number; rmsL: number; rmsR: number };
const silent: MeterValue = { peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 };
const meters = new Map<string, MeterValue>();
const listeners = new Set<() => void>();
export const meterSnapshot = (id: string) => meters.get(id) ?? silent;
export const subscribeMeters = (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; };
export function publishMeters(values: Record<string, MeterValue>) { for (const [id, value] of Object.entries(values)) meters.set(id, value); listeners.forEach((cb) => cb()); }
export function clearMeters() { meters.clear(); listeners.forEach((cb) => cb()); }
let transport: { id: string; send: (mixer: MixerState, revision?: number) => Promise<MixerResponse> } | undefined;
const connections = new Set<(id: string) => void>();
export function onMixerConnected(callback: (id: string) => void) { connections.add(callback); return () => connections.delete(callback); }
export function setMixerTransport(next: typeof transport) { transport = next; if (next) connections.forEach((callback) => callback(next.id)); }
export function releaseMixerTransport(id: string | null) { if (id && transport?.id === id) { transport = undefined; clearMeters(); } }
export function sendMixerUpdate(id: string, mixer: MixerState, revision?: number): Promise<MixerResponse> | undefined { return transport?.id === id ? transport.send(mixer, revision) : undefined; }
