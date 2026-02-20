import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";

import {
  buildSequencerNoteOptions,
  parseSequencerScaleValue,
  SEQUENCER_MODE_OPTIONS,
  SEQUENCER_SCALE_OPTIONS,
  sequencerModeLabel,
  sequencerScaleLabel
} from "../lib/sequencer";
import type {
  PatchListItem,
  PerformanceListItem,
  PianoRollState,
  SequencerInstrumentBinding,
  SequencerMode,
  SequencerScaleRoot,
  SequencerScaleType,
  SequencerState,
  SequencerTrackState
} from "../types";

const PIANO_ROLL_START_NOTE = 24; // C1
const PIANO_ROLL_NOTE_COUNT = 84; // C1..B7
const PIANO_WHITE_KEY_WIDTH = 36;
const PIANO_WHITE_KEY_HEIGHT = 132;
const PIANO_BLACK_KEY_WIDTH = 22;
const PIANO_BLACK_KEY_HEIGHT = 84;
const PIANO_SCROLL_STEP_PX = PIANO_WHITE_KEY_WIDTH * 8;

function clampMidiControllerValue(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)));
}

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

interface PianoRollKeyboardProps {
  roll: PianoRollState;
  instrumentsRunning: boolean;
  onNoteOn: (note: number, channel: number) => void;
  onNoteOff: (note: number, channel: number) => void;
}

function PianoRollKeyboard({ roll, instrumentsRunning, onNoteOn, onNoteOff }: PianoRollKeyboardProps) {
  const interactive = instrumentsRunning && roll.enabled;
  const pianoRollOptions = useMemo(
    () => buildSequencerNoteOptions(roll.scaleRoot, roll.mode),
    [roll.mode, roll.scaleRoot]
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
    const whiteKeys: Array<{ note: number; label: string; inScale: boolean; degree: number | null }> = [];
    const blackKeys: Array<{ note: number; left: number; label: string; inScale: boolean; degree: number | null }> = [];
    let whiteIndex = 0;

    for (const note of pianoRollNotes) {
      const option = pianoRollOptionsByNote.get(note);
      const inScale = option?.inScale ?? false;
      const degree = option?.degree ?? null;
      const label = pianoKeyPrimaryLabel(option?.label, note);

      if (isBlackPianoKey(note)) {
        blackKeys.push({
          note,
          left: whiteIndex * PIANO_WHITE_KEY_WIDTH - PIANO_BLACK_KEY_WIDTH / 2,
          label,
          inScale,
          degree
        });
        continue;
      }

      whiteKeys.push({
        note,
        label,
        inScale,
        degree
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
      onNoteOff(held.note, held.channel);
      setPianoNoteActive(held.note, false);
    },
    [onNoteOff, setPianoNoteActive]
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
        onNoteOff(existing.note, existing.channel);
        setPianoNoteActive(existing.note, false);
      }

      pianoPointerNotesRef.current[event.pointerId] = { note, channel };
      onNoteOn(note, channel);
      setPianoNoteActive(note, true);
    },
    [interactive, onNoteOff, onNoteOn, roll.midiChannel, setPianoNoteActive]
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
      onNoteOff(held.note, held.channel);
    }
    pianoPointerNotesRef.current = {};
    setActivePianoNotes({});
  }, [interactive, onNoteOff]);

  useEffect(() => {
    return () => {
      for (const held of Object.values(pianoPointerNotesRef.current)) {
        onNoteOff(held.note, held.channel);
      }
      pianoPointerNotesRef.current = {};
    };
  }, [onNoteOff]);

  return (
    <div className="relative rounded-xl border border-slate-700 bg-slate-950/70 p-2.5">
      <div className="mb-2 text-[11px] text-slate-500">7 octaves keyboard (C1..B7).</div>

      {pianoHasOverflow && (
        <>
          <button
            type="button"
            onClick={() => scrollPianoKeyboard(-1)}
            disabled={!pianoCanScrollLeft}
            aria-label="Scroll keyboard left"
            className="absolute left-1 top-1/2 z-40 -translate-y-1/2 rounded-full border border-slate-600 bg-slate-900/90 px-2 py-2 font-mono text-sm text-slate-100 transition hover:bg-slate-800 disabled:opacity-40"
          >
            {"<"}
          </button>
          <button
            type="button"
            onClick={() => scrollPianoKeyboard(1)}
            disabled={!pianoCanScrollRight}
            aria-label="Scroll keyboard right"
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
                  style={{ width: `${PIANO_WHITE_KEY_WIDTH}px` }}
                >
                  <span>{key.label}</span>
                  {key.degree ? <span className="text-[9px] text-emerald-700">({key.degree})</span> : null}
                </button>
              );
            })}
          </div>

          <div className="pointer-events-none absolute inset-0">
            {pianoKeyboard.blackKeys.map((key) => {
              const isActive = activePianoNotes[key.note] === true;
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
                    height: `${PIANO_BLACK_KEY_HEIGHT}px`
                  }}
                >
                  <span>{key.label}</span>
                  {key.degree ? <span className="text-[8px] text-emerald-300">({key.degree})</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

interface MidiControllerKnobProps {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

function MidiControllerKnob({ value, disabled, onChange }: MidiControllerKnobProps) {
  const pointerStateRef = useRef<{ pointerId: number; startY: number; startValue: number } | null>(null);
  const normalizedValue = clampMidiControllerValue(value);
  const angle = -135 + (normalizedValue / 127) * 270;

  const releasePointer = useCallback((pointerId: number) => {
    if (pointerStateRef.current?.pointerId !== pointerId) {
      return;
    }
    pointerStateRef.current = null;
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || disabled) {
        return;
      }

      event.preventDefault();
      pointerStateRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startValue: normalizedValue
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [disabled, normalizedValue]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const pointerState = pointerStateRef.current;
      if (!pointerState || pointerState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const delta = pointerState.startY - event.clientY;
      const nextValue = clampMidiControllerValue(pointerState.startValue + delta * 0.5);
      onChange(nextValue);
    },
    [onChange]
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      releasePointer(event.pointerId);
    },
    [releasePointer]
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      releasePointer(event.pointerId);
    },
    [releasePointer]
  );

  useEffect(() => {
    if (!disabled) {
      return;
    }
    pointerStateRef.current = null;
  }, [disabled]);

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      className={`relative h-16 w-16 rounded-full border transition ${
        disabled
          ? "cursor-not-allowed border-slate-700 bg-slate-900/80 opacity-50"
          : "border-cyan-400/70 bg-slate-900 hover:border-cyan-300"
      }`}
      aria-label={`Controller knob value ${normalizedValue}`}
    >
      <span className="absolute inset-1 rounded-full border border-slate-700 bg-[radial-gradient(circle_at_35%_25%,_#1e293b,_#020617_72%)]" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span
          className="relative h-9 w-1.5"
          style={{
            transform: `rotate(${angle}deg)`
          }}
        >
          <span className="absolute inset-x-0 top-0 h-3.5 rounded-full bg-cyan-200 shadow-[0_0_8px_rgba(34,211,238,0.55)]" />
        </span>
      </span>
    </button>
  );
}

interface SequencerPageProps {
  patches: PatchListItem[];
  performances: PerformanceListItem[];
  instrumentBindings: SequencerInstrumentBinding[];
  sequencer: SequencerState;
  currentPerformanceId: string | null;
  performanceName: string;
  performanceDescription: string;
  instrumentsRunning: boolean;
  sessionState: string;
  midiInputName: string | null;
  transportError: string | null;
  onAddInstrument: () => void;
  onRemoveInstrument: (bindingId: string) => void;
  onInstrumentPatchChange: (bindingId: string, patchId: string) => void;
  onInstrumentChannelChange: (bindingId: string, channel: number) => void;
  onPerformanceNameChange: (value: string) => void;
  onPerformanceDescriptionChange: (value: string) => void;
  onSavePerformance: () => void;
  onLoadPerformance: (performanceId: string) => void;
  onExportConfig: () => void;
  onImportConfig: (file: File) => void;
  onStartInstruments: () => void;
  onStopInstruments: () => void;
  onBpmChange: (bpm: number) => void;
  onAddSequencerTrack: () => void;
  onRemoveSequencerTrack: (trackId: string) => void;
  onSequencerTrackEnabledChange: (trackId: string, enabled: boolean) => void;
  onSequencerTrackChannelChange: (trackId: string, channel: number) => void;
  onSequencerTrackScaleChange: (trackId: string, scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
  onSequencerTrackModeChange: (trackId: string, mode: SequencerMode) => void;
  onSequencerTrackStepCountChange: (trackId: string, count: 16 | 32) => void;
  onSequencerTrackStepNoteChange: (trackId: string, index: number, note: number | null) => void;
  onSequencerPadPress: (trackId: string, padIndex: number) => void;
  onAddPianoRoll: () => void;
  onRemovePianoRoll: (rollId: string) => void;
  onPianoRollEnabledChange: (rollId: string, enabled: boolean) => void;
  onPianoRollMidiChannelChange: (rollId: string, channel: number) => void;
  onPianoRollScaleChange: (rollId: string, scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
  onPianoRollModeChange: (rollId: string, mode: SequencerMode) => void;
  onPianoRollNoteOn: (note: number, channel: number) => void;
  onPianoRollNoteOff: (note: number, channel: number) => void;
  onAddMidiController: () => void;
  onRemoveMidiController: (controllerId: string) => void;
  onMidiControllerEnabledChange: (controllerId: string, enabled: boolean) => void;
  onMidiControllerNumberChange: (controllerId: string, controllerNumber: number) => void;
  onMidiControllerValueChange: (controllerId: string, value: number) => void;
  onResetPlayhead: () => void;
  onAllNotesOff: () => void;
}

function trackStateLabel(track: SequencerTrackState): string {
  if (track.queuedEnabled === true) {
    return "starting @ step 1";
  }
  if (track.queuedEnabled === false) {
    return "stopping @ step 1";
  }
  return track.enabled ? "running" : "stopped";
}

function previousNonRestNote(steps: Array<number | null>, fromIndex: number): number | null {
  for (let index = fromIndex - 1; index >= 0; index -= 1) {
    const note = steps[index];
    if (typeof note === "number") {
      return note;
    }
  }
  return null;
}

export function SequencerPage({
  patches,
  performances,
  instrumentBindings,
  sequencer,
  currentPerformanceId,
  performanceName,
  performanceDescription,
  instrumentsRunning,
  sessionState,
  midiInputName,
  transportError,
  onAddInstrument,
  onRemoveInstrument,
  onInstrumentPatchChange,
  onInstrumentChannelChange,
  onPerformanceNameChange,
  onPerformanceDescriptionChange,
  onSavePerformance,
  onLoadPerformance,
  onExportConfig,
  onImportConfig,
  onStartInstruments,
  onStopInstruments,
  onBpmChange,
  onAddSequencerTrack,
  onRemoveSequencerTrack,
  onSequencerTrackEnabledChange,
  onSequencerTrackChannelChange,
  onSequencerTrackScaleChange,
  onSequencerTrackModeChange,
  onSequencerTrackStepCountChange,
  onSequencerTrackStepNoteChange,
  onSequencerPadPress,
  onAddPianoRoll,
  onRemovePianoRoll,
  onPianoRollEnabledChange,
  onPianoRollMidiChannelChange,
  onPianoRollScaleChange,
  onPianoRollModeChange,
  onPianoRollNoteOn,
  onPianoRollNoteOff,
  onAddMidiController,
  onRemoveMidiController,
  onMidiControllerEnabledChange,
  onMidiControllerNumberChange,
  onMidiControllerValueChange,
  onResetPlayhead,
  onAllNotesOff
}: SequencerPageProps) {
  const configFileInputRef = useRef<HTMLInputElement | null>(null);
  const [stepSelectPreview, setStepSelectPreview] = useState<Record<string, string>>({});
  const triggerConfigLoad = useCallback(() => {
    configFileInputRef.current?.click();
  }, []);

  const handleConfigFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      onImportConfig(file);
      event.target.value = "";
    },
    [onImportConfig]
  );

  const transportStartButtonClass =
    "rounded-md border border-emerald-400/55 bg-emerald-400/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300 transition hover:bg-emerald-400/30 disabled:cursor-not-allowed disabled:opacity-50";
  const transportStopButtonClass =
    "rounded-md border border-amber-400/55 bg-amber-400/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200 transition hover:bg-amber-400/30 disabled:cursor-not-allowed disabled:opacity-50";
  const transportStateClass =
    "rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[10px] text-slate-300";
  const controlLabelClass = "text-[10px] uppercase tracking-[0.18em] text-slate-400";
  const controlFieldClass =
    "rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring";

  return (
    <section className="rounded-2xl border border-slate-700/70 bg-slate-900/70 p-3 shadow-glow">
      <input
        ref={configFileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleConfigFileChange}
      />

      <div className="rounded-xl border border-cyan-800/45 bg-slate-950/85 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-200">Instrument Rack</div>
          <div className="ml-auto rounded-full border border-slate-700 bg-slate-950 px-3 py-1 font-mono text-xs text-slate-300">
            state: {sessionState}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1 lg:col-span-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Performance Name</span>
            <input
              value={performanceName}
              onChange={(event) => onPerformanceNameChange(event.target.value)}
              placeholder="Live Set A"
              className="rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring"
            />
          </label>

          <label className="flex flex-col gap-1 lg:col-span-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Description</span>
            <input
              value={performanceDescription}
              onChange={(event) => onPerformanceDescriptionChange(event.target.value)}
              placeholder="Stage-ready configuration"
              className="rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Load Performance</span>
            <select
              value={currentPerformanceId ?? ""}
              onChange={(event) => {
                if (event.target.value.length > 0) {
                  onLoadPerformance(event.target.value);
                }
              }}
              className="rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring"
            >
              <option value="">Current</option>
              {performances.map((performance) => (
                <option key={performance.id} value={performance.id}>
                  {performance.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAddInstrument}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25"
          >
            Add Instrument
          </button>
          <button
            type="button"
            onClick={onSavePerformance}
            className="rounded-md border border-mint/55 bg-mint/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-mint transition hover:bg-mint/25"
          >
            Save Performance
          </button>
          <button
            type="button"
            onClick={onExportConfig}
            className="rounded-md border border-slate-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
          >
            Export
          </button>
          <button
            type="button"
            onClick={triggerConfigLoad}
            className="rounded-md border border-slate-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
          >
            Import
          </button>
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
          {instrumentBindings.length === 0 ? (
            <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
              Add at least one saved instrument to start the engine.
            </div>
          ) : (
            instrumentBindings.map((binding, index) => (
              <div
                key={binding.id}
                className="grid grid-cols-[minmax(0,_1fr)_88px_auto] items-end gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-2"
              >
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Patch {index + 1}</span>
                  <select
                    value={binding.patchId}
                    onChange={(event) => onInstrumentPatchChange(binding.id, event.target.value)}
                    className="rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring"
                  >
                    {patches.map((patch) => (
                      <option key={`rack-${binding.id}-${patch.id}`} value={patch.id}>
                        {patch.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Channel</span>
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={binding.midiChannel}
                    onChange={(event) => onInstrumentChannelChange(binding.id, Number(event.target.value))}
                    className="w-full rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onRemoveInstrument(binding.id)}
                  className="rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 rounded-lg border border-cyan-900/55 bg-slate-900/65 p-2.5">
          <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Rack Transport</div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onStartInstruments}
              disabled={instrumentsRunning}
              className={transportStartButtonClass}
            >
              Start Instruments
            </button>
            <button
              type="button"
              onClick={onStopInstruments}
              disabled={!instrumentsRunning}
              className={transportStopButtonClass}
            >
              Stop Instruments
            </button>
            <span className={transportStateClass}>{instrumentsRunning ? "running" : "stopped"}</span>
          </div>
        </div>
      </div>

      {transportError && (
        <div className="mt-3 rounded-xl border border-rose-500/60 bg-rose-950/50 px-3 py-2 font-mono text-xs text-rose-200">
          {transportError}
        </div>
      )}

      <div className="mt-4 rounded-xl border border-sky-800/45 bg-slate-950/85 p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-sky-200">Sequencers</div>
          <button
            type="button"
            onClick={onAddSequencerTrack}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25"
          >
            Add Sequencer
          </button>
        </div>

        <div className="mb-3 rounded-lg border border-sky-900/55 bg-slate-900/65 p-2.5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Global Sequencer Clock</div>
            <span className={transportStateClass}>{sequencer.isPlaying ? "running" : "stopped"}</span>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className={controlLabelClass}>BPM</span>
              <input
                type="number"
                min={30}
                max={300}
                value={sequencer.bpm}
                onChange={(event) => onBpmChange(Number(event.target.value))}
                className={`${controlFieldClass} w-24`}
              />
            </label>
          </div>
        </div>

        <div className="space-y-3">
          {sequencer.tracks.map((track, trackIndex) => {
            const noteOptions = buildSequencerNoteOptions(track.scaleRoot, track.mode);
            const noteOptionsByNote = new Map(noteOptions.map((option) => [option.note, option]));
            const inScaleOptions = noteOptions.filter((option) => option.inScale);
            const outOfScaleOptions = noteOptions.filter((option) => !option.inScale);
            const scaleLabel = sequencerScaleLabel(track.scaleRoot, track.scaleType);
            const modeLabel = sequencerModeLabel(track.mode);
            const scaleValue = `${track.scaleRoot}:${track.scaleType}`;
            const stepIndices = Array.from({ length: track.stepCount }, (_, index) => index);

            return (
              <article key={track.id} className="rounded-xl border border-slate-700 bg-slate-900/65 p-2.5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">
                    {track.name || `Sequencer ${trackIndex + 1}`}
                  </div>
                  <span className={transportStateClass}>{trackStateLabel(track)}</span>
                  <button
                    type="button"
                    onClick={() => onSequencerTrackEnabledChange(track.id, !track.enabled)}
                    disabled={!instrumentsRunning && !track.enabled}
                    className={track.enabled ? transportStopButtonClass : transportStartButtonClass}
                  >
                    {track.enabled ? "Stop" : "Start"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveSequencerTrack(track.id)}
                    className="rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25"
                  >
                    Remove
                  </button>
                </div>

                <div className="mb-2 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className={controlLabelClass}>MIDI Channel</span>
                    <input
                      type="number"
                      min={1}
                      max={16}
                      value={track.midiChannel}
                      onChange={(event) => onSequencerTrackChannelChange(track.id, Number(event.target.value))}
                      className={`${controlFieldClass} w-24`}
                    />
                  </label>

                  <label className="flex min-w-[180px] flex-col gap-1">
                    <span className={controlLabelClass}>Scale</span>
                    <select
                      value={scaleValue}
                      onChange={(event) => {
                        const selected = parseSequencerScaleValue(event.target.value);
                        if (selected) {
                          onSequencerTrackScaleChange(track.id, selected.root, selected.type);
                        }
                      }}
                      className={controlFieldClass}
                    >
                      {SEQUENCER_SCALE_OPTIONS.map((option) => (
                        <option key={`${track.id}-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex min-w-[160px] flex-col gap-1">
                    <span className={controlLabelClass}>Mode</span>
                    <select
                      value={track.mode}
                      onChange={(event) => onSequencerTrackModeChange(track.id, event.target.value as SequencerMode)}
                      className={controlFieldClass}
                    >
                      {SEQUENCER_MODE_OPTIONS.map((option) => (
                        <option key={`${track.id}-mode-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex flex-col gap-1">
                    <span className={controlLabelClass}>Steps</span>
                    <div className="inline-flex rounded-lg border border-slate-600 bg-slate-950 p-1">
                      <button
                        type="button"
                        onClick={() => onSequencerTrackStepCountChange(track.id, 16)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                          track.stepCount === 16 ? "bg-accent/30 text-accent" : "text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        16
                      </button>
                      <button
                        type="button"
                        onClick={() => onSequencerTrackStepCountChange(track.id, 32)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                          track.stepCount === 32 ? "bg-accent/30 text-accent" : "text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        32
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mb-2 text-[11px] text-slate-500">
                  Notes in <span className="text-emerald-300">{scaleLabel}</span> /{" "}
                  <span className="text-emerald-300">{modeLabel}</span>
                </div>

                <div className="mb-2">
                  <div className="mb-1 text-xs uppercase tracking-[0.2em] text-slate-400">Pattern Pads</div>
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                    {Array.from({ length: 8 }, (_, padIndex) => {
                      const isActivePad = track.activePad === padIndex;
                      const isQueuedPad = track.queuedPad === padIndex;
                      return (
                        <button
                          key={`${track.id}-pad-${padIndex}`}
                          type="button"
                          onClick={() => onSequencerPadPress(track.id, padIndex)}
                          className={`rounded-md border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                            isActivePad
                              ? "border-accent bg-accent/25 text-accent"
                              : isQueuedPad
                                ? "border-amber-400/70 bg-amber-500/10 text-amber-300"
                                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                          }`}
                        >
                          P{padIndex + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="overflow-x-auto pb-1">
                  <div
                    className="grid gap-1.5"
                    style={{
                      gridTemplateColumns: `repeat(${track.stepCount}, minmax(96px, 1fr))`,
                      minWidth: `${Math.max(720, track.stepCount * 100)}px`
                    }}
                  >
                    {stepIndices.map((step) => {
                      const noteValue = track.steps[step];
                      const localPlayhead = sequencer.playhead % track.stepCount;
                      const isActive = track.enabled && sequencer.isPlaying && localPlayhead === step;
                      const selectedNote = noteValue === null ? null : noteOptionsByNote.get(noteValue) ?? null;
                      const isInScale = selectedNote?.inScale ?? false;
                      const degree = selectedNote?.degree ?? null;
                      const stepKey = `${track.id}:${step}`;
                      const selectValue = stepSelectPreview[stepKey] ?? (noteValue === null ? "" : String(noteValue));
                      const selectedLabel = noteValue === null ? "Rest" : pianoKeyPrimaryLabel(selectedNote?.label, noteValue);

                      return (
                        <div
                          key={`${track.id}-step-${step}`}
                          className={`rounded-md border p-1.5 transition ${
                            isActive
                              ? "border-accent bg-accent/15 shadow-[0_0_0_1px_rgba(14,165,233,0.55)]"
                              : isInScale
                                ? "border-emerald-500/70 bg-emerald-900/20"
                                : "border-slate-700 bg-slate-900"
                          }`}
                        >
                          <div className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
                            {step + 1}
                          </div>

                          <div className="relative mt-1">
                            <select
                              value={selectValue}
                              onMouseDown={(event) => {
                                if (event.button !== 0 || noteValue !== null) {
                                  return;
                                }
                                const fallbackNote = previousNonRestNote(track.steps, step);
                                if (fallbackNote === null) {
                                  return;
                                }
                                const fallbackValue = String(fallbackNote);
                                setStepSelectPreview((previous) =>
                                  previous[stepKey] === fallbackValue
                                    ? previous
                                    : {
                                        ...previous,
                                        [stepKey]: fallbackValue
                                      }
                                );
                                onSequencerTrackStepNoteChange(track.id, step, fallbackNote);
                              }}
                              onFocus={() => {
                                if (noteValue !== null) {
                                  return;
                                }
                                const fallbackNote = previousNonRestNote(track.steps, step);
                                if (fallbackNote === null) {
                                  return;
                                }
                                const fallbackValue = String(fallbackNote);
                                setStepSelectPreview((previous) =>
                                  previous[stepKey] === fallbackValue
                                    ? previous
                                    : {
                                        ...previous,
                                        [stepKey]: fallbackValue
                                      }
                                );
                              }}
                              onBlur={() => {
                                setStepSelectPreview((previous) => {
                                  if (!(stepKey in previous)) {
                                    return previous;
                                  }
                                  const next = { ...previous };
                                  delete next[stepKey];
                                  return next;
                                });
                              }}
                              onChange={(event) => {
                                const raw = event.target.value.trim();
                                setStepSelectPreview((previous) => {
                                  if (!(stepKey in previous)) {
                                    return previous;
                                  }
                                  const next = { ...previous };
                                  delete next[stepKey];
                                  return next;
                                });
                                onSequencerTrackStepNoteChange(track.id, step, raw.length === 0 ? null : Number(raw));
                              }}
                              className="h-8 w-full appearance-none rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-center font-mono text-[11px] text-transparent outline-none ring-accent/40 transition focus:ring"
                            >
                              <option value="" style={{ color: "#f8fafc" }}>
                                Rest
                              </option>
                              <optgroup label={`In scale: ${scaleLabel} / ${modeLabel}`}>
                                {inScaleOptions.map((option) => (
                                  <option key={`${track.id}-in-${option.note}`} value={option.note} style={{ color: "#f8fafc" }}>
                                    {option.label}
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label="Out of scale">
                                {outOfScaleOptions.map((option) => (
                                  <option key={`${track.id}-out-${option.note}`} value={option.note} style={{ color: "#f8fafc" }}>
                                    {option.label}
                                  </option>
                                ))}
                              </optgroup>
                            </select>
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[11px] text-slate-100">
                              {selectedLabel}
                            </div>
                          </div>

                          <div
                            className={`mt-1 text-center text-[10px] ${
                              noteValue === null ? "text-slate-500" : isInScale ? "text-emerald-300" : "text-amber-300"
                            }`}
                          >
                            {noteValue === null ? "rest" : isInScale ? `in scale (${degree})` : "out of scale"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-emerald-800/45 bg-slate-950/85 p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200">Piano Rolls</div>
          <button
            type="button"
            onClick={onAddPianoRoll}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25"
          >
            Add Piano Roll
          </button>
        </div>

        <div className="space-y-3">
          {sequencer.pianoRolls.map((roll, rollIndex) => {
            const scaleValue = `${roll.scaleRoot}:${roll.scaleType}`;
            const scaleLabel = sequencerScaleLabel(roll.scaleRoot, roll.scaleType);
            const modeLabel = sequencerModeLabel(roll.mode);
            return (
              <article key={roll.id} className="rounded-xl border border-slate-700 bg-slate-900/65 p-2.5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">
                    {roll.name || `Piano Roll ${rollIndex + 1}`}
                  </div>
                  <span className={transportStateClass}>{roll.enabled ? "running" : "stopped"}</span>
                  <button
                    type="button"
                    onClick={() => onPianoRollEnabledChange(roll.id, !roll.enabled)}
                    disabled={!instrumentsRunning && !roll.enabled}
                    className={roll.enabled ? transportStopButtonClass : transportStartButtonClass}
                  >
                    {roll.enabled ? "Stop" : "Start"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemovePianoRoll(roll.id)}
                    className="rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25"
                  >
                    Remove
                  </button>
                </div>

                <div className="mb-2 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className={controlLabelClass}>MIDI Channel</span>
                    <input
                      type="number"
                      min={1}
                      max={16}
                      value={roll.midiChannel}
                      onChange={(event) => onPianoRollMidiChannelChange(roll.id, Number(event.target.value))}
                      className={`${controlFieldClass} w-24`}
                    />
                  </label>
                  <label className="flex min-w-[180px] flex-col gap-1">
                    <span className={controlLabelClass}>Scale</span>
                    <select
                      value={scaleValue}
                      onChange={(event) => {
                        const selected = parseSequencerScaleValue(event.target.value);
                        if (selected) {
                          onPianoRollScaleChange(roll.id, selected.root, selected.type);
                        }
                      }}
                      className={controlFieldClass}
                    >
                      {SEQUENCER_SCALE_OPTIONS.map((option) => (
                        <option key={`${roll.id}-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-[160px] flex-col gap-1">
                    <span className={controlLabelClass}>Mode</span>
                    <select
                      value={roll.mode}
                      onChange={(event) => onPianoRollModeChange(roll.id, event.target.value as SequencerMode)}
                      className={controlFieldClass}
                    >
                      {SEQUENCER_MODE_OPTIONS.map((option) => (
                        <option key={`${roll.id}-mode-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mb-2 text-[11px] text-slate-500">
                  In-scale notes for <span className="text-emerald-300">{scaleLabel}</span> /{" "}
                  <span className="text-emerald-300">{modeLabel}</span> are highlighted with degrees.
                </div>

                <div className="relative left-1/2 w-screen -translate-x-1/2 px-4 sm:px-6 lg:px-8">
                  <PianoRollKeyboard
                    roll={roll}
                    instrumentsRunning={instrumentsRunning}
                    onNoteOn={onPianoRollNoteOn}
                    onNoteOff={onPianoRollNoteOff}
                  />
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-violet-800/45 bg-slate-950/85 p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-violet-200">
            MIDI Controllers ({sequencer.midiControllers.length}/16)
          </div>
          <button
            type="button"
            onClick={onAddMidiController}
            disabled={sequencer.midiControllers.length >= 16}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add Controller
          </button>
        </div>

        {sequencer.midiControllers.length === 0 ? (
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
            Add a MIDI controller to send CC values.
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {sequencer.midiControllers.map((controller, controllerIndex) => (
              <article key={controller.id} className="rounded-xl border border-slate-700 bg-slate-900/65 p-2.5">
                <div className="mb-2 flex items-center gap-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">
                    {controller.name || `Controller ${controllerIndex + 1}`}
                  </div>
                  <span className={transportStateClass}>{controller.enabled ? "running" : "stopped"}</span>
                </div>

                <div className="mb-2 flex flex-wrap items-end gap-2">
                  <label className="flex min-w-[120px] flex-col gap-1">
                    <span className={controlLabelClass}>Controller #</span>
                    <input
                      type="number"
                      min={0}
                      max={127}
                      value={controller.controllerNumber}
                      onChange={(event) => onMidiControllerNumberChange(controller.id, Number(event.target.value))}
                      className={`${controlFieldClass} w-24`}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => onMidiControllerEnabledChange(controller.id, !controller.enabled)}
                    className={controller.enabled ? transportStopButtonClass : transportStartButtonClass}
                  >
                    {controller.enabled ? "Stop" : "Start"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveMidiController(controller.id)}
                    className="rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25"
                  >
                    Remove
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <MidiControllerKnob
                    value={controller.value}
                    disabled={false}
                    onChange={(value) => onMidiControllerValueChange(controller.id, value)}
                  />
                  <div className="space-y-1">
                    <div className={controlLabelClass}>Value</div>
                    <div className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100">
                      {controller.value}
                    </div>
                    <div className="text-[10px] text-slate-500">click + drag up/down</div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-xs text-slate-300">
        <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
          playhead: {sequencer.playhead + 1}/{sequencer.stepCount}
        </span>
        <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
          cycle: {sequencer.cycle}
        </span>
        <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
          midi input: {midiInputName ?? "none"}
        </span>
        <button
          type="button"
          onClick={onResetPlayhead}
          className="rounded-lg border border-slate-500 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
        >
          Reset Playhead
        </button>
        <button
          type="button"
          onClick={onAllNotesOff}
          className="rounded-lg border border-amber-400/50 bg-amber-400/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-200 transition hover:bg-amber-400/30"
        >
          All Notes Off
        </button>
      </div>
    </section>
  );
}
