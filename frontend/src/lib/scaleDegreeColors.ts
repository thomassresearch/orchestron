export interface HsvColor {
  h: number;
  s: number;
  v: number;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const DEGREE_RAINBOW_HSV: Record<number, HsvColor> = {
  1: { h: 0, s: 0.86, v: 0.94 },
  2: { h: 30, s: 0.87, v: 0.95 },
  3: { h: 54, s: 0.84, v: 0.95 },
  4: { h: 120, s: 0.74, v: 0.86 },
  5: { h: 170, s: 0.78, v: 0.85 },
  6: { h: 220, s: 0.8, v: 0.9 },
  7: { h: 275, s: 0.74, v: 0.9 }
};

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeHue(value: number): number {
  const modulo = value % 360;
  return modulo < 0 ? modulo + 360 : modulo;
}

function blendHsvColors(colors: HsvColor[]): HsvColor | null {
  if (colors.length === 0) {
    return null;
  }

  let x = 0;
  let y = 0;
  let saturation = 0;
  let value = 0;
  for (const color of colors) {
    const radians = (normalizeHue(color.h) * Math.PI) / 180;
    x += Math.cos(radians);
    y += Math.sin(radians);
    saturation += clamp01(color.s);
    value += clamp01(color.v);
  }

  return {
    h: normalizeHue((Math.atan2(y / colors.length, x / colors.length) * 180) / Math.PI),
    s: clamp01(saturation / colors.length),
    v: clamp01(value / colors.length)
  };
}

export function hsvToRgb(color: HsvColor): RgbColor {
  const hue = normalizeHue(color.h);
  const saturation = clamp01(color.s);
  const value = clamp01(color.v);

  const c = value * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = value - c;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (hue < 60) {
    rPrime = c;
    gPrime = x;
  } else if (hue < 120) {
    rPrime = x;
    gPrime = c;
  } else if (hue < 180) {
    gPrime = c;
    bPrime = x;
  } else if (hue < 240) {
    gPrime = x;
    bPrime = c;
  } else if (hue < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255)
  };
}

export function rgbToCss(color: RgbColor): string {
  return `rgb(${color.r} ${color.g} ${color.b})`;
}

export function colorForDegrees(degrees: number[]): HsvColor | null {
  const colors = degrees.map((degree) => DEGREE_RAINBOW_HSV[degree]).filter((color): color is HsvColor => color !== undefined);
  return blendHsvColors(colors);
}

export function scaleDegreeBorderBackground(degrees: number[]): string | undefined {
  const colors = [...new Set(degrees)].sort((a, b) => a - b)
    .map(degree => DEGREE_RAINBOW_HSV[degree])
    .filter((color): color is HsvColor => color !== undefined)
    .map(color => rgbToCss(hsvToRgb(color)));
  if (colors.length === 0) return undefined;
  if (colors.length === 1) return colors[0];
  return `conic-gradient(${colors.map((color, i) => `${color} ${i * 100 / colors.length}% ${(i + 1) * 100 / colors.length}%`).join(", ")})`;
}
