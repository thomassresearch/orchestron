import data from "../../../backend/app/data/dx7.json";
import type { NodeInstance } from "../types";

export const dx7OperatorMax = data.operatorMax;
export const dx7Offset = (op: number) => (6 - op) * 21;

export function dx7Voice(params: NodeInstance["params"]): number[] {
  const raw = atob(typeof params.voice === "string" ? params.voice : data.initialVoice);
  return Array.from(raw, ch => ch.charCodeAt(0));
}

export function encodeDx7(voice: number[]) {
  return btoa(String.fromCharCode(...voice));
}

export const dx7Name = (voice: number[]) => String.fromCharCode(...voice.slice(145)).replace(/[^ -~]/g, " ").trimEnd();

// VCED stores OP6 first. Lay out each layer above the operators it feeds,
// keeping branches in operator order and all carriers on the output bus.
export const dx7Algorithms = data.algorithms.map(route => {
  const depths: number[] = [];
  for (let op = 1; op <= 6; op++) {
    const destinations = route.edges.filter(([source]) => source === op).map(([, dest]) => dest);
    depths.push(Math.max(0, ...destinations.map(dest => depths[dest - 1] + 1)));
  }
  const top = Math.max(...depths);
  const layers = Array.from({ length: top + 1 }, (_, depth) => [6, 5, 4, 3, 2, 1].filter(op => depths[op - 1] === depth));
  const columns = Math.max(...layers.map(ops => ops.length));
  const positions: number[][] = [];
  layers.forEach((ops, depth) => {
    let previous = -1;
    ops.forEach((op, index) => {
      const targets = route.edges.filter(([source]) => source === op).map(([, dest]) => positions[dest - 1][0]);
      const preferred = targets.length ? targets.reduce((a, b) => a + b, 0) / targets.length * columns - .5
        : (index + .5) * columns / ops.length - .5;
      const column = Math.min(columns - (ops.length - index), Math.max(previous + 1, Math.round(preferred)));
      positions[op - 1] = [(column + .5) / columns, top - depth];
      previous = column;
    });
  });
  return { ...route, positions };
});

export function dx7Frequency(voice: number[], offset: number) {
  const coarse = voice[offset + 18], fine = voice[offset + 19];
  const fixed = voice[offset + 17] === 1;
  const value = fixed ? 10 ** (coarse % 4 + fine / 100) : (coarse || .5) * (1 + fine / 100);
  return { fixed, value, label: Number(value.toFixed(2)) + (fixed ? " Hz" : "×") };
}

// Schematic stage widths. Rate follows the UDO's exponential speed scale.
// Compress time so a fast attack and slow release can be seen together.
export function dx7Envelope(voice: number[], offset: number, startLevel = 0) {
  let x = 0, level = startLevel;
  const points = [{ x, level }];
  for (let stage = 0; stage < 4; stage++) {
    if (stage === 3) { x += 16; points.push({ x, level }); }
    const target = voice[offset + 4 + stage];
    const rate = Math.floor(voice[offset + stage] * 41 / 64);
    const speed = (4 + rate % 4) * 2 ** Math.floor(rate / 4);
    x += 5 + 9 * Math.log1p((1 + Math.abs(target - level)) * 36 / speed);
    level = target;
    points.push({ x, level });
  }
  return points.map(p => ({ x: p.x / x, y: 1 - p.level / 99 }));
}
