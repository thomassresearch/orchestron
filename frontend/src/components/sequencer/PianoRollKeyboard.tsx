import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { buildSequencerNoteOptions, scaleDegreeForNote } from "../../lib/sequencer";
import type { PianoRollState, SequencerMode, SequencerScaleRoot } from "../../types";
import type { SequencerUiCopy } from "./sequencerUiCopy";

const PIANO_ROLL_START_NOTE = 12; // C0
const PIANO_ROLL_NOTE_COUNT = 96; // C0..B7
const PIANO_WHITE_KEY_WIDTH = 36;
const PIANO_WHITE_KEY_HEIGHT = 132;
const PIANO_BLACK_KEY_WIDTH = 22;
const PIANO_BLACK_KEY_HEIGHT = 84;
const PIANO_SCROLL_STEP_PX = PIANO_WHITE_KEY_WIDTH * 8;

function normalizePitchClass(note: number): number {
  const modulo = Math.round(note) % 12;
  return modulo < 0 ? modulo + 12 : modulo;
}

function isBlackPianoKey(note: number): boolean {
  const pitchClass = normalizePitchClass(note);
  return pitchClass === 1 || pitchClass === 3 || pitchClass === 6 || pitchClass === 8 || pitchClass === 10;
}

function pianoKeyPrimaryLabel(label: string | undefined, note: number): string {
  if (!label || label.trim().length === 0) {
    return String(note);
  }
  const withoutDegree = label.replace(/\s+\(\d+\)$/, "");
  const [primary] = withoutDegree.split(" / ");
  return primary.trim();
}

interface SequencerPitchClassOption {
  pitchClass: number;
  label: string;
  degree: number | null;
  inScale: boolean;
}

export function pianoKeyNoteName(label: string | undefined, note: number): string {
  return pianoKeyPrimaryLabel(label, note).replace(/-?\d+$/, "").trim();
}

export function midiNotePitchClass(note: number): number {
  return normalizePitchClass(note);
}

export function midiNoteOctave(note: number, tonicPitchClass = 0): number {
  const roundedNote = Math.round(note);
  const normalizedTonicPitchClass = normalizePitchClass(tonicPitchClass);
  const pitchClass = normalizePitchClass(roundedNote);
  const chromaticOctave = Math.floor(roundedNote / 12) - 1;
  return pitchClass < normalizedTonicPitchClass ? chromaticOctave - 1 : chromaticOctave;
}

export function sequencerMidiNoteFromPitchClassOctave(pitchClass: number, octave: number, tonicPitchClass = 0): number {
  const normalizedPitchClass = normalizePitchClass(pitchClass);
  const normalizedTonicPitchClass = normalizePitchClass(tonicPitchClass);
  const normalizedOctave = Math.max(0, Math.min(7, Math.round(octave)));
  const chromaticOctave = normalizedPitchClass < normalizedTonicPitchClass ? normalizedOctave + 1 : normalizedOctave;
  return normalizedPitchClass + (chromaticOctave + 1) * 12;
}

export function buildSequencerPitchClassOptions(
  noteOptions: Array<{ note: number; label: string; degree: number | null; inScale: boolean }>
): SequencerPitchClassOption[] {
  const byPitchClass = new Map<number, SequencerPitchClassOption>();
  const tonicPitchClass = (() => {
    const tonic = noteOptions.find((option) => option.degree === 1);
    return tonic ? midiNotePitchClass(tonic.note) : 0;
  })();
  for (const option of noteOptions) {
    const pitchClass = midiNotePitchClass(option.note);
    if (byPitchClass.has(pitchClass)) {
      continue;
    }
    byPitchClass.set(pitchClass, {
      pitchClass,
      label: pianoKeyNoteName(option.label, option.note),
      degree: option.degree,
      inScale: option.inScale
    });
    if (byPitchClass.size >= 12) {
      break;
    }
  }
  return Array.from(byPitchClass.values()).sort((a, b) => {
    const aOffset = (a.pitchClass - tonicPitchClass + 12) % 12;
    const bOffset = (b.pitchClass - tonicPitchClass + 12) % 12;
    return aOffset - bOffset;
  });
}

export function chordColorTextClass(color: "neutral" | "green" | "orange" | "red"): string {
  if (color === "green") {
    return "text-emerald-300";
  }
  if (color === "orange") {
    return "text-amber-300";
  }
  if (color === "red") {
    return "text-rose-300";
  }
  return "text-slate-100";
}

export function chordColorBorderClass(color: "neutral" | "green" | "orange" | "red"): string {
  if (color === "green") {
    return "border-emerald-500/50";
  }
  if (color === "orange") {
    return "border-amber-500/50";
  }
  if (color === "red") {
    return "border-rose-500/50";
  }
  return "border-slate-700";
}

export function chordOptionInlineStyle(color: "neutral" | "green" | "orange" | "red"): CSSProperties {
  if (color === "green") {
    return { color: "#86efac" };
  }
  if (color === "orange") {
    return { color: "#fcd34d" };
  }
  if (color === "red") {
    return { color: "#fda4af" };
  }
  return { color: "#f8fafc" };
}

export interface PianoRollHighlightTheory {
  scaleRoot: SequencerScaleRoot;
  mode: SequencerMode;
}

interface PianoRollNoteDisplay {
  note: number;
  label: string;
  inScale: boolean;
  degrees: number[];
  degreeText: string | null;
  highlightColor: HsvColor | null;
}

interface HsvColor {
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

function clamp01(value: number): number {
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

function hsvToRgb(color: HsvColor): RgbColor {
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

function rgbToCss(color: RgbColor): string {
  return `rgb(${color.r} ${color.g} ${color.b})`;
}

function colorForDegrees(degrees: number[]): HsvColor | null {
  const colors = degrees.map((degree) => DEGREE_RAINBOW_HSV[degree]).filter((color): color is HsvColor => color !== undefined);
  return blendHsvColors(colors);
}

function whiteKeyHighlightStyle(color: HsvColor | null): CSSProperties | undefined {
  if (!color) {
    return undefined;
  }

  const border = hsvToRgb({ h: color.h, s: clamp01(color.s * 0.78), v: clamp01(color.v * 0.72) });
  const background = hsvToRgb({ h: color.h, s: clamp01(color.s * 0.24), v: 0.99 });
  const text = hsvToRgb({ h: color.h, s: clamp01(color.s * 0.82), v: clamp01(color.v * 0.32) });

  return {
    borderColor: rgbToCss(border),
    backgroundColor: rgbToCss(background),
    color: rgbToCss(text)
  };
}

function whiteDegreeStyle(color: HsvColor | null): CSSProperties | undefined {
  if (!color) {
    return undefined;
  }
  const degreeText = hsvToRgb({ h: color.h, s: clamp01(color.s * 0.86), v: clamp01(color.v * 0.42) });
  return { color: rgbToCss(degreeText) };
}

function blackKeyHighlightStyle(color: HsvColor | null): CSSProperties | undefined {
  if (!color) {
    return undefined;
  }

  const border = hsvToRgb({ h: color.h, s: clamp01(color.s * 0.88), v: clamp01(color.v * 0.78) });
  const background = hsvToRgb({ h: color.h, s: clamp01(color.s * 0.76), v: clamp01(color.v * 0.46) });
  const text = hsvToRgb({ h: color.h, s: clamp01(color.s * 0.2), v: 0.98 });

  return {
    borderColor: rgbToCss(border),
    backgroundColor: rgbToCss(background),
    color: rgbToCss(text)
  };
}

function blackDegreeStyle(color: HsvColor | null): CSSProperties | undefined {
  if (!color) {
    return undefined;
  }
  const degreeText = hsvToRgb({ h: color.h, s: clamp01(color.s * 0.3), v: 0.93 });
  return { color: rgbToCss(degreeText) };
}

export function numberArrayEqual(a: number[], b: number[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function pianoRollHighlightTheoriesEqual(a: PianoRollHighlightTheory[], b: PianoRollHighlightTheory[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index].scaleRoot !== b[index].scaleRoot || a[index].mode !== b[index].mode) {
      return false;
    }
  }
  return true;
}

interface PianoRollKeyboardProps {
  ui: SequencerUiCopy;
  roll: PianoRollState;
  instrumentsRunning: boolean;
  highlightTheories: PianoRollHighlightTheory[];
  onNoteOn: (rollId: string, note: number, channel: number, velocity: number) => void;
  onNoteOff: (rollId: string, note: number, channel: number) => void;
}

export const PianoRollKeyboard = memo(function PianoRollKeyboard({
  ui,
  roll,
  instrumentsRunning,
  highlightTheories,
  onNoteOn,
  onNoteOff
}: PianoRollKeyboardProps) {
  const interactive = instrumentsRunning && roll.enabled;
  const effectiveTheories = useMemo<PianoRollHighlightTheory[]>(
    () =>
      highlightTheories.length > 0
        ? highlightTheories
        : [
            {
              scaleRoot: roll.scaleRoot,
              mode: roll.mode
            }
          ],
    [highlightTheories, roll.mode, roll.scaleRoot]
  );
  const labelTheory = effectiveTheories[0];
  const noteLabelsByNote = useMemo(
    () =>
      new Map(
        buildSequencerNoteOptions(labelTheory.scaleRoot, labelTheory.mode).map((option) => [
          option.note,
          pianoKeyPrimaryLabel(option.label, option.note)
        ])
      ),
    [labelTheory.mode, labelTheory.scaleRoot]
  );
  const pianoRollOptions = useMemo<PianoRollNoteDisplay[]>(
    () =>
      Array.from({ length: 128 }, (_, note) => {
        const label = noteLabelsByNote.get(note) ?? String(note);
        const degrees: number[] = [];

        for (const theory of effectiveTheories) {
          const degree = scaleDegreeForNote(note, theory.scaleRoot, theory.mode);
          if (degree === null) {
            return {
              note,
              label,
              inScale: false,
              degrees: [],
              degreeText: null,
              highlightColor: null
            };
          }
          degrees.push(degree);
        }

        return {
          note,
          label,
          inScale: true,
          degrees,
          degreeText: degrees.join("/"),
          highlightColor: colorForDegrees(degrees)
        };
      }),
    [effectiveTheories, noteLabelsByNote]
  );
  const pianoRollOptionsByNote = useMemo(
    () => new Map(pianoRollOptions.map((option) => [option.note, option])),
    [pianoRollOptions]
  );
  const pianoRollNotes = useMemo(
    () => Array.from({ length: PIANO_ROLL_NOTE_COUNT }, (_, index) => PIANO_ROLL_START_NOTE + index),
    []
  );
  const pianoKeyboard = useMemo(() => {
    const whiteKeys: Array<{
      note: number;
      label: string;
      inScale: boolean;
      degreeText: string | null;
      highlightColor: HsvColor | null;
    }> = [];
    const blackKeys: Array<{
      note: number;
      left: number;
      label: string;
      inScale: boolean;
      degreeText: string | null;
      highlightColor: HsvColor | null;
    }> = [];
    let whiteIndex = 0;

    for (const note of pianoRollNotes) {
      const option = pianoRollOptionsByNote.get(note);
      const inScale = option?.inScale ?? false;
      const degreeText = option?.degreeText ?? null;
      const label = option?.label ?? String(note);
      const highlightColor = option?.highlightColor ?? null;

      if (isBlackPianoKey(note)) {
        blackKeys.push({
          note,
          left: whiteIndex * PIANO_WHITE_KEY_WIDTH - PIANO_BLACK_KEY_WIDTH / 2,
          label,
          inScale,
          degreeText,
          highlightColor
        });
        continue;
      }

      whiteKeys.push({
        note,
        label,
        inScale,
        degreeText,
        highlightColor
      });
      whiteIndex += 1;
    }

    return {
      whiteKeys,
      blackKeys,
      width: whiteIndex * PIANO_WHITE_KEY_WIDTH
    };
  }, [pianoRollNotes, pianoRollOptionsByNote]);

  const [activePianoNotes, setActivePianoNotes] = useState<Record<number, true>>({});
  const pianoPointerNotesRef = useRef<Record<number, { note: number; channel: number }>>({});
  const pianoKeyboardViewportRef = useRef<HTMLDivElement | null>(null);
  const [pianoHasOverflow, setPianoHasOverflow] = useState(false);
  const [pianoCanScrollLeft, setPianoCanScrollLeft] = useState(false);
  const [pianoCanScrollRight, setPianoCanScrollRight] = useState(false);

  const updatePianoScrollState = useCallback(() => {
    const viewport = pianoKeyboardViewportRef.current;
    if (!viewport) {
      setPianoHasOverflow(false);
      setPianoCanScrollLeft(false);
      setPianoCanScrollRight(false);
      return;
    }

    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const hasOverflow = maxScrollLeft > 1;
    setPianoHasOverflow(hasOverflow);
    setPianoCanScrollLeft(hasOverflow && viewport.scrollLeft > 1);
    setPianoCanScrollRight(hasOverflow && viewport.scrollLeft < maxScrollLeft - 1);
  }, []);

  useEffect(() => {
    updatePianoScrollState();
    const onResize = () => updatePianoScrollState();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [updatePianoScrollState, pianoKeyboard.width]);

  const scrollPianoKeyboard = useCallback(
    (direction: -1 | 1) => {
      const viewport = pianoKeyboardViewportRef.current;
      if (!viewport) {
        return;
      }
      viewport.scrollBy({
        left: direction * PIANO_SCROLL_STEP_PX,
        behavior: "smooth"
      });
      window.setTimeout(() => {
        updatePianoScrollState();
      }, 220);
    },
    [updatePianoScrollState]
  );

  const setPianoNoteActive = useCallback((note: number, active: boolean) => {
    if (active) {
      setActivePianoNotes((previous) => {
        if (previous[note]) {
          return previous;
        }
        return { ...previous, [note]: true };
      });
      return;
    }

    setActivePianoNotes((previous) => {
      if (!previous[note]) {
        return previous;
      }
      const next = { ...previous };
      delete next[note];
      return next;
    });
  }, []);

  const releasePianoPointer = useCallback(
    (pointerId: number) => {
      const held = pianoPointerNotesRef.current[pointerId];
      if (!held) {
        return;
      }

      delete pianoPointerNotesRef.current[pointerId];
      onNoteOff(roll.id, held.note, held.channel);
      setPianoNoteActive(held.note, false);
    },
    [onNoteOff, roll.id, setPianoNoteActive]
  );

  const handlePianoPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, note: number) => {
      if (event.button !== 0) {
        return;
      }
      if (!interactive) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const channel = roll.midiChannel;
      const existing = pianoPointerNotesRef.current[event.pointerId];
      if (existing) {
        onNoteOff(roll.id, existing.note, existing.channel);
        setPianoNoteActive(existing.note, false);
      }

      pianoPointerNotesRef.current[event.pointerId] = { note, channel };
      onNoteOn(roll.id, note, channel, roll.velocity);
      setPianoNoteActive(note, true);
    },
    [interactive, onNoteOff, onNoteOn, roll.id, roll.midiChannel, roll.velocity, setPianoNoteActive]
  );

  const handlePianoPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      releasePianoPointer(event.pointerId);
    },
    [releasePianoPointer]
  );

  const handlePianoPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      releasePianoPointer(event.pointerId);
    },
    [releasePianoPointer]
  );

  useEffect(() => {
    if (interactive) {
      return;
    }

    for (const held of Object.values(pianoPointerNotesRef.current)) {
      onNoteOff(roll.id, held.note, held.channel);
    }
    pianoPointerNotesRef.current = {};
    setActivePianoNotes({});
  }, [interactive, onNoteOff, roll.id]);

  useEffect(() => {
    return () => {
      for (const held of Object.values(pianoPointerNotesRef.current)) {
        onNoteOff(roll.id, held.note, held.channel);
      }
      pianoPointerNotesRef.current = {};
    };
  }, [onNoteOff, roll.id]);

  return (
    <div className="relative rounded-xl border border-slate-700 bg-slate-950/70 p-2.5">
      <div className="mb-2 text-[11px] text-slate-500">{ui.keyboardInfo}</div>

      {pianoHasOverflow && (
        <>
          <button
            type="button"
            onClick={() => scrollPianoKeyboard(-1)}
            disabled={!pianoCanScrollLeft}
            aria-label={ui.scrollKeyboardLeft}
            className="absolute left-1 top-1/2 z-40 -translate-y-1/2 rounded-full border border-slate-600 bg-slate-900/90 px-2 py-2 font-mono text-sm text-slate-100 transition hover:bg-slate-800 disabled:opacity-40"
          >
            {"<"}
          </button>
          <button
            type="button"
            onClick={() => scrollPianoKeyboard(1)}
            disabled={!pianoCanScrollRight}
            aria-label={ui.scrollKeyboardRight}
            className="absolute right-1 top-1/2 z-40 -translate-y-1/2 rounded-full border border-slate-600 bg-slate-900/90 px-2 py-2 font-mono text-sm text-slate-100 transition hover:bg-slate-800 disabled:opacity-40"
          >
            {">"}
          </button>
        </>
      )}

      <div
        ref={pianoKeyboardViewportRef}
        onScroll={updatePianoScrollState}
        className="overflow-x-auto pb-1"
      >
        <div
          className="relative"
          style={{
            width: `${pianoKeyboard.width}px`,
            height: `${PIANO_WHITE_KEY_HEIGHT}px`
          }}
        >
          <div className="absolute inset-0 flex items-start">
            {pianoKeyboard.whiteKeys.map((key) => {
              const isActive = activePianoNotes[key.note] === true;
              const highlightStyle =
                !isActive && key.inScale ? whiteKeyHighlightStyle(key.highlightColor) : undefined;
              const degreeStyle =
                !isActive && key.inScale ? whiteDegreeStyle(key.highlightColor) : undefined;
              return (
                <button
                  key={`piano-white-${roll.id}-${key.note}`}
                  type="button"
                  disabled={!interactive}
                  onPointerDown={(event) => handlePianoPointerDown(event, key.note)}
                  onPointerUp={handlePianoPointerUp}
                  onPointerCancel={handlePianoPointerCancel}
                  onLostPointerCapture={handlePianoPointerCancel}
                  className={`relative flex h-full shrink-0 flex-col items-center justify-end border px-1 pb-2 text-center font-mono text-[10px] transition ${
                    isActive
                      ? "z-20 border-accent bg-accent/25 text-accent"
                      : key.inScale
                        ? "border-emerald-500/80 bg-emerald-100 text-emerald-950"
                        : "border-slate-500 bg-white text-slate-900 hover:bg-slate-50"
                  } ${interactive ? "" : "cursor-not-allowed opacity-45"}`}
                  style={{ width: `${PIANO_WHITE_KEY_WIDTH}px`, ...highlightStyle }}
                >
                  <span>{key.label}</span>
                  {key.degreeText ? (
                    <span className="text-[9px] text-emerald-700" style={degreeStyle}>
                      ({key.degreeText})
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="pointer-events-none absolute inset-0">
            {pianoKeyboard.blackKeys.map((key) => {
              const isActive = activePianoNotes[key.note] === true;
              const highlightStyle =
                !isActive && key.inScale ? blackKeyHighlightStyle(key.highlightColor) : undefined;
              const degreeStyle =
                !isActive && key.inScale ? blackDegreeStyle(key.highlightColor) : undefined;
              return (
                <button
                  key={`piano-black-${roll.id}-${key.note}`}
                  type="button"
                  disabled={!interactive}
                  onPointerDown={(event) => handlePianoPointerDown(event, key.note)}
                  onPointerUp={handlePianoPointerUp}
                  onPointerCancel={handlePianoPointerCancel}
                  onLostPointerCapture={handlePianoPointerCancel}
                  className={`pointer-events-auto absolute top-0 z-30 flex flex-col items-center justify-end rounded-b-md border px-1 pb-1 text-center font-mono text-[9px] transition ${
                    isActive
                      ? "border-accent bg-accent/35 text-accent"
                      : key.inScale
                        ? "border-emerald-400/90 bg-emerald-900 text-emerald-100"
                        : "border-slate-950 bg-black text-slate-100 hover:bg-slate-900"
                  } ${interactive ? "" : "cursor-not-allowed opacity-45"}`}
                  style={{
                    left: `${key.left}px`,
                    width: `${PIANO_BLACK_KEY_WIDTH}px`,
                    height: `${PIANO_BLACK_KEY_HEIGHT}px`,
                    ...highlightStyle
                  }}
                >
                  <span>{key.label}</span>
                  {key.degreeText ? (
                    <span className="text-[8px] text-emerald-300" style={degreeStyle}>
                      ({key.degreeText})
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}, arePianoRollKeyboardPropsEqual);

function arePianoRollKeyboardPropsEqual(previous: PianoRollKeyboardProps, next: PianoRollKeyboardProps): boolean {
  return (
    previous.ui === next.ui &&
    previous.roll === next.roll &&
    previous.instrumentsRunning === next.instrumentsRunning &&
    previous.onNoteOn === next.onNoteOn &&
    previous.onNoteOff === next.onNoteOff &&
    pianoRollHighlightTheoriesEqual(previous.highlightTheories, next.highlightTheories)
  );
}



