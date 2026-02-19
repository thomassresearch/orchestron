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
  SequencerInstrumentBinding,
  SequencerMode,
  SequencerScaleRoot,
  SequencerScaleType,
  SequencerState
} from "../types";

const PIANO_ROLL_START_NOTE = 24; // C1
const PIANO_ROLL_NOTE_COUNT = 84; // C1 .. B7 (7 octaves)
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

interface SequencerPageProps {
  patches: PatchListItem[];
  instrumentBindings: SequencerInstrumentBinding[];
  sequencer: SequencerState;
  instrumentsRunning: boolean;
  pianoRollRunning: boolean;
  sessionState: string;
  midiInputName: string | null;
  transportError: string | null;
  onAddInstrument: () => void;
  onRemoveInstrument: (bindingId: string) => void;
  onInstrumentPatchChange: (bindingId: string, patchId: string) => void;
  onInstrumentChannelChange: (bindingId: string, channel: number) => void;
  onSaveConfig: () => void;
  onLoadConfig: (file: File) => void;
  onStartInstruments: () => void;
  onStopInstruments: () => void;
  onStartSequencerPlayback: () => void;
  onStopSequencerPlayback: () => void;
  onStartPianoRoll: () => void;
  onStopPianoRoll: () => void;
  onBpmChange: (bpm: number) => void;
  onMidiChannelChange: (channel: number) => void;
  onScaleChange: (scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
  onModeChange: (mode: SequencerMode) => void;
  onStepCountChange: (count: 16 | 32) => void;
  onStepNoteChange: (index: number, note: number | null) => void;
  onPadPress: (padIndex: number) => void;
  onPianoRollMidiChannelChange: (channel: number) => void;
  onPianoRollScaleChange: (scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
  onPianoRollModeChange: (mode: SequencerMode) => void;
  onPianoRollNoteOn: (note: number, channel: number) => void;
  onPianoRollNoteOff: (note: number, channel: number) => void;
  onResetPlayhead: () => void;
  onAllNotesOff: () => void;
}

export function SequencerPage({
  patches,
  instrumentBindings,
  sequencer,
  instrumentsRunning,
  pianoRollRunning,
  sessionState,
  midiInputName,
  transportError,
  onAddInstrument,
  onRemoveInstrument,
  onInstrumentPatchChange,
  onInstrumentChannelChange,
  onSaveConfig,
  onLoadConfig,
  onStartInstruments,
  onStopInstruments,
  onStartSequencerPlayback,
  onStopSequencerPlayback,
  onStartPianoRoll,
  onStopPianoRoll,
  onBpmChange,
  onMidiChannelChange,
  onScaleChange,
  onModeChange,
  onStepCountChange,
  onStepNoteChange,
  onPadPress,
  onPianoRollMidiChannelChange,
  onPianoRollScaleChange,
  onPianoRollModeChange,
  onPianoRollNoteOn,
  onPianoRollNoteOff,
  onResetPlayhead,
  onAllNotesOff
}: SequencerPageProps) {
  const stepIndices = Array.from({ length: sequencer.stepCount }, (_, index) => index);
  const noteOptions = useMemo(
    () => buildSequencerNoteOptions(sequencer.scaleRoot, sequencer.mode),
    [sequencer.scaleRoot, sequencer.mode]
  );
  const noteOptionsByNote = useMemo(() => new Map(noteOptions.map((option) => [option.note, option])), [noteOptions]);
  const inScaleOptions = useMemo(() => noteOptions.filter((option) => option.inScale), [noteOptions]);
  const outOfScaleOptions = useMemo(() => noteOptions.filter((option) => !option.inScale), [noteOptions]);
  const activeScaleLabel = sequencerScaleLabel(sequencer.scaleRoot, sequencer.scaleType);
  const activeModeLabel = sequencerModeLabel(sequencer.mode);
  const scaleValue = `${sequencer.scaleRoot}:${sequencer.scaleType}`;
  const pianoRollScaleLabel = sequencerScaleLabel(sequencer.pianoRollScaleRoot, sequencer.pianoRollScaleType);
  const pianoRollModeLabel = sequencerModeLabel(sequencer.pianoRollMode);
  const pianoRollScaleValue = `${sequencer.pianoRollScaleRoot}:${sequencer.pianoRollScaleType}`;
  const pianoRollOptions = useMemo(
    () => buildSequencerNoteOptions(sequencer.pianoRollScaleRoot, sequencer.pianoRollMode),
    [sequencer.pianoRollMode, sequencer.pianoRollScaleRoot]
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
  const [stepSelectPreviewByStep, setStepSelectPreviewByStep] = useState<Record<number, number>>({});
  const stepPreviewCommitByStepRef = useRef<Record<number, number>>({});
  const [activePianoNotes, setActivePianoNotes] = useState<Record<number, true>>({});
  const pianoPointerNotesRef = useRef<Record<number, { note: number; channel: number }>>({});
  const pianoKeyboardViewportRef = useRef<HTMLDivElement | null>(null);
  const [pianoHasOverflow, setPianoHasOverflow] = useState(false);
  const [pianoCanScrollLeft, setPianoCanScrollLeft] = useState(false);
  const [pianoCanScrollRight, setPianoCanScrollRight] = useState(false);
  const configFileInputRef = useRef<HTMLInputElement | null>(null);

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

  const triggerConfigLoad = useCallback(() => {
    configFileInputRef.current?.click();
  }, []);

  const handleConfigFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      onLoadConfig(file);
      event.target.value = "";
    },
    [onLoadConfig]
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
      onPianoRollNoteOff(held.note, held.channel);
      setPianoNoteActive(held.note, false);
    },
    [onPianoRollNoteOff, setPianoNoteActive]
  );

  const handlePianoPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, note: number) => {
      if (event.button !== 0) {
        return;
      }
      if (!(instrumentsRunning && pianoRollRunning)) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);

      const channel = sequencer.pianoRollMidiChannel;
      const existing = pianoPointerNotesRef.current[event.pointerId];
      if (existing) {
        onPianoRollNoteOff(existing.note, existing.channel);
        setPianoNoteActive(existing.note, false);
      }

      pianoPointerNotesRef.current[event.pointerId] = { note, channel };
      onPianoRollNoteOn(note, channel);
      setPianoNoteActive(note, true);
    },
    [
      instrumentsRunning,
      onPianoRollNoteOff,
      onPianoRollNoteOn,
      pianoRollRunning,
      sequencer.pianoRollMidiChannel,
      setPianoNoteActive
    ]
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
    return () => {
      for (const held of Object.values(pianoPointerNotesRef.current)) {
        onPianoRollNoteOff(held.note, held.channel);
      }
      pianoPointerNotesRef.current = {};
    };
  }, [onPianoRollNoteOff]);

  const clearStepSelectPreview = useCallback((stepIndex: number) => {
    setStepSelectPreviewByStep((previous) => {
      if (!(stepIndex in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[stepIndex];
      return next;
    });
  }, []);

  const clearStepPreviewCommit = useCallback((stepIndex: number) => {
    if (!(stepIndex in stepPreviewCommitByStepRef.current)) {
      return;
    }
    delete stepPreviewCommitByStepRef.current[stepIndex];
  }, []);

  const resolveStepPreviewNote = useCallback(
    (stepIndex: number, noteValue: number | null): number | null => {
      if (noteValue !== null) {
        return null;
      }

      const cached = stepSelectPreviewByStep[stepIndex];
      if (typeof cached === "number") {
        return cached;
      }

      for (let index = stepIndex - 1; index >= 0; index -= 1) {
        const candidate = sequencer.steps[index];
        if (typeof candidate === "number") {
          return candidate;
        }
      }

      return null;
    },
    [sequencer.steps, stepSelectPreviewByStep]
  );

  const primeStepSelectPreview = useCallback(
    (stepIndex: number, noteValue: number | null) => {
      const previewNote = resolveStepPreviewNote(stepIndex, noteValue);
      if (previewNote === null) {
        return;
      }

      setStepSelectPreviewByStep((previous) => {
        if (previous[stepIndex] === previewNote) {
          return previous;
        }

        return {
          ...previous,
          [stepIndex]: previewNote
        };
      });
    },
    [resolveStepPreviewNote]
  );

  const armStepPreviewCommit = useCallback(
    (stepIndex: number, noteValue: number | null) => {
      const previewNote = resolveStepPreviewNote(stepIndex, noteValue);
      if (previewNote === null) {
        clearStepPreviewCommit(stepIndex);
        return;
      }
      stepPreviewCommitByStepRef.current[stepIndex] = previewNote;
    },
    [clearStepPreviewCommit, resolveStepPreviewNote]
  );

  const pianoRollInteractive = instrumentsRunning && pianoRollRunning;
  const transportStartButtonClass =
    "rounded-md border border-emerald-400/55 bg-emerald-400/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300 transition hover:bg-emerald-400/30 disabled:cursor-not-allowed disabled:opacity-50";
  const transportStopButtonClass =
    "rounded-md border border-amber-400/55 bg-amber-400/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200 transition hover:bg-amber-400/30 disabled:cursor-not-allowed disabled:opacity-50";
  const transportStateClass =
    "rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[10px] text-slate-300";
  const controlLabelClass = "text-[10px] uppercase tracking-[0.18em] text-slate-400";
  const controlFieldClass =
    "rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring";

  useEffect(() => {
    if (pianoRollInteractive) {
      return;
    }

    for (const held of Object.values(pianoPointerNotesRef.current)) {
      onPianoRollNoteOff(held.note, held.channel);
    }
    pianoPointerNotesRef.current = {};
    setActivePianoNotes({});
  }, [onPianoRollNoteOff, pianoRollInteractive]);

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
          <button
            type="button"
            onClick={onAddInstrument}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25"
          >
            Add Instrument
          </button>
          <button
            type="button"
            onClick={onSaveConfig}
            className="rounded-md border border-slate-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
          >
            Save Config
          </button>
          <button
            type="button"
            onClick={triggerConfigLoad}
            className="rounded-md border border-slate-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
          >
            Load Config
          </button>
          <div className="ml-auto rounded-full border border-slate-700 bg-slate-950 px-3 py-1 font-mono text-xs text-slate-300">
            state: {sessionState}
          </div>
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
        <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-sky-200">Sequencer</div>
        <div className="mb-3 rounded-lg border border-sky-900/55 bg-slate-900/65 p-2.5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Sequencer Transport</div>
            <button
              type="button"
              onClick={onStartSequencerPlayback}
              disabled={sequencer.isPlaying || !instrumentsRunning}
              className={transportStartButtonClass}
            >
              Start
            </button>
            <button
              type="button"
              onClick={onStopSequencerPlayback}
              disabled={!sequencer.isPlaying}
              className={transportStopButtonClass}
            >
              Stop
            </button>
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

            <label className="flex flex-col gap-1">
              <span className={controlLabelClass}>MIDI Channel</span>
              <input
                type="number"
                min={1}
                max={16}
                value={sequencer.midiChannel}
                onChange={(event) => onMidiChannelChange(Number(event.target.value))}
                className={`${controlFieldClass} w-28`}
              />
            </label>

            <label className="flex min-w-[200px] flex-col gap-1">
              <span className={controlLabelClass}>Scale</span>
              <select
                value={scaleValue}
                onChange={(event) => {
                  const selected = parseSequencerScaleValue(event.target.value);
                  if (selected) {
                    onScaleChange(selected.root, selected.type);
                  }
                }}
                className={controlFieldClass}
              >
                {SEQUENCER_SCALE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-[170px] flex-col gap-1">
              <span className={controlLabelClass}>Mode</span>
              <select
                value={sequencer.mode}
                onChange={(event) => onModeChange(event.target.value as SequencerMode)}
                className={controlFieldClass}
              >
                {SEQUENCER_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
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
                  onClick={() => onStepCountChange(16)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                    sequencer.stepCount === 16 ? "bg-accent/30 text-accent" : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  16
                </button>
                <button
                  type="button"
                  onClick={() => onStepCountChange(32)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                    sequencer.stepCount === 32 ? "bg-accent/30 text-accent" : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  32
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-3">
          <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Pattern Pads</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {Array.from({ length: 8 }, (_, padIndex) => {
              const isActivePad = sequencer.activePad === padIndex;
              const isQueuedPad = sequencer.queuedPad === padIndex;
              return (
                <button
                  key={padIndex}
                  type="button"
                  onClick={() => onPadPress(padIndex)}
                  className={`rounded-lg border px-2 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
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
          <div className="mt-2 text-[11px] text-slate-500">
            {sequencer.isPlaying
              ? "Press pad to queue. Current loop finishes before switch."
              : "Press pad to select the active pattern."}
          </div>
        </div>

        <div className="mb-1 text-xs uppercase tracking-[0.2em] text-slate-400">Step Grid</div>
        <div className="mb-2 text-[11px] text-slate-500">
          Notes in <span className="text-emerald-300">{activeScaleLabel}</span> with mode{" "}
          <span className="text-emerald-300">{activeModeLabel}</span> are highlighted and show their degree in parentheses.
        </div>
        <div className="overflow-x-auto pb-2">
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${sequencer.stepCount}, minmax(150px, 1fr))`,
              minWidth: `${Math.max(920, sequencer.stepCount * 160)}px`
            }}
          >
            {stepIndices.map((step) => {
              const noteValue = sequencer.steps[step];
              const isActive = sequencer.isPlaying && sequencer.playhead === step;
              const selectedNote = noteValue === null ? null : noteOptionsByNote.get(noteValue) ?? null;
              const isInScale = selectedNote?.inScale ?? false;
              const degree = selectedNote?.degree ?? null;
              const previewNote = stepSelectPreviewByStep[step];
              const selectValue =
                noteValue === null ? (previewNote === undefined ? "" : String(previewNote)) : String(noteValue);

              return (
                <div
                  key={step}
                  className={`rounded-lg border p-2 transition ${
                    isActive
                      ? "border-accent bg-accent/15 shadow-[0_0_0_1px_rgba(14,165,233,0.55)]"
                      : isInScale
                        ? "border-emerald-500/70 bg-emerald-900/20"
                      : "border-slate-700 bg-slate-900"
                  }`}
                >
                  <div className="text-center font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
                    {step + 1}
                  </div>
                  <select
                    value={selectValue}
                    onChange={(event) => {
                      const raw = event.target.value.trim();
                      onStepNoteChange(step, raw.length === 0 ? null : Number(raw));
                      clearStepPreviewCommit(step);
                      clearStepSelectPreview(step);
                    }}
                    onFocus={() => primeStepSelectPreview(step, noteValue)}
                    onMouseDown={() => {
                      primeStepSelectPreview(step, noteValue);
                      armStepPreviewCommit(step, noteValue);
                    }}
                    onBlur={() => {
                      const pendingPreview = stepPreviewCommitByStepRef.current[step];
                      if (noteValue === null && pendingPreview !== undefined) {
                        onStepNoteChange(step, pendingPreview);
                      }
                      clearStepPreviewCommit(step);
                      clearStepSelectPreview(step);
                    }}
                    className="mt-2 w-full rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-center font-mono text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring"
                  >
                    <option value="">Rest</option>
                    <optgroup label={`In scale: ${activeScaleLabel} / ${activeModeLabel}`}>
                      {inScaleOptions.map((option) => (
                        <option key={`in-${option.note}`} value={option.note}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Out of scale">
                      {outOfScaleOptions.map((option) => (
                        <option key={`out-${option.note}`} value={option.note}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <div
                    className={`mt-1 text-center text-[10px] ${
                      noteValue === null
                        ? "text-slate-500"
                        : isInScale
                          ? "text-emerald-300"
                          : "text-amber-300"
                    }`}
                  >
                    {noteValue === null ? "rest" : isInScale ? `in scale (${degree})` : "out of scale"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-emerald-800/45 bg-slate-950/85 p-3">
        <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-emerald-200">Piano Roll</div>
        <div className="mb-3 rounded-lg border border-emerald-900/55 bg-slate-900/65 p-2.5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Piano Roll Transport</div>
            <button
              type="button"
              onClick={onStartPianoRoll}
              disabled={pianoRollRunning || !instrumentsRunning}
              className={transportStartButtonClass}
            >
              Start
            </button>
            <button
              type="button"
              onClick={onStopPianoRoll}
              disabled={!pianoRollRunning}
              className={transportStopButtonClass}
            >
              Stop
            </button>
            <span className={transportStateClass}>{pianoRollRunning ? "running" : "stopped"}</span>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className={controlLabelClass}>MIDI Channel</span>
              <input
                type="number"
                min={1}
                max={16}
                value={sequencer.pianoRollMidiChannel}
                onChange={(event) => onPianoRollMidiChannelChange(Number(event.target.value))}
                className={`${controlFieldClass} w-32`}
              />
            </label>

            <label className="flex min-w-[220px] flex-col gap-1">
              <span className={controlLabelClass}>Scale</span>
              <select
                value={pianoRollScaleValue}
                onChange={(event) => {
                  const selected = parseSequencerScaleValue(event.target.value);
                  if (selected) {
                    onPianoRollScaleChange(selected.root, selected.type);
                  }
                }}
                className={controlFieldClass}
              >
                {SEQUENCER_SCALE_OPTIONS.map((option) => (
                  <option key={`piano-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-[180px] flex-col gap-1">
              <span className={controlLabelClass}>Mode</span>
              <select
                value={sequencer.pianoRollMode}
                onChange={(event) => onPianoRollModeChange(event.target.value as SequencerMode)}
                className={controlFieldClass}
              >
                {SEQUENCER_MODE_OPTIONS.map((option) => (
                  <option key={`piano-mode-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mb-3 text-[11px] text-slate-500">
          Click keys to trigger notes while sequencer playback continues. In-scale notes for{" "}
          <span className="text-emerald-300">{pianoRollScaleLabel}</span> /{" "}
          <span className="text-emerald-300">{pianoRollModeLabel}</span> are highlighted with degrees.
        </div>

        <div className="relative left-1/2 w-screen -translate-x-1/2 px-4 sm:px-6 lg:px-8">
          <div className="relative rounded-xl border border-slate-700 bg-slate-950/70 p-2.5">
            <div className="mb-2 text-[11px] text-slate-500">
              7 octaves keyboard (C1..B7). Low notes on the left, high notes on the right.
            </div>

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
                        key={`piano-white-${key.note}`}
                        type="button"
                        disabled={!pianoRollInteractive}
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
                        } ${pianoRollInteractive ? "" : "cursor-not-allowed opacity-45"}`}
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
                        key={`piano-black-${key.note}`}
                        type="button"
                        disabled={!pianoRollInteractive}
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
                        } ${pianoRollInteractive ? "" : "cursor-not-allowed opacity-45"}`}
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
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-xs text-slate-300">
        <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
          playhead: {sequencer.playhead + 1}/{sequencer.stepCount}
        </span>
        <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
          pad: {sequencer.activePad + 1}
          {sequencer.queuedPad === null ? "" : ` -> ${sequencer.queuedPad + 1}`}
        </span>
        <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
          cycle: {sequencer.cycle}
        </span>
        <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
          scale: {activeScaleLabel} / {activeModeLabel}
        </span>
        <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
          ch: {sequencer.midiChannel}
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
