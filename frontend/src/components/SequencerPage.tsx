import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";

import {
  buildSequencerNoteOptions,
  parseSequencerScaleValue,
  SEQUENCER_MODE_OPTIONS,
  SEQUENCER_SCALE_OPTIONS
} from "../lib/sequencer";
import { HelpIconButton } from "./HelpIconButton";
import type {
  GuiLanguage,
  HelpDocId,
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

type SequencerUiCopy = {
  keyboardInfo: string;
  scrollKeyboardLeft: string;
  scrollKeyboardRight: string;
  controllerKnobValue: (value: number) => string;
  trackQueuedStart: string;
  trackQueuedStop: string;
  running: string;
  stopped: string;
  instrumentRack: string;
  state: string;
  performanceName: string;
  performanceNamePlaceholder: string;
  description: string;
  performanceDescriptionPlaceholder: string;
  loadPerformance: string;
  current: string;
  addInstrument: string;
  savePerformance: string;
  export: string;
  import: string;
  noInstrumentHint: string;
  patch: (index: number) => string;
  channel: string;
  remove: string;
  rackTransport: string;
  startInstruments: string;
  stopInstruments: string;
  sequencers: string;
  addSequencer: string;
  globalSequencerClock: string;
  bpm: string;
  midiChannel: string;
  scale: string;
  mode: string;
  steps: string;
  notesInScaleMode: (scale: string, mode: string) => string;
  patternPads: string;
  sequencerWithIndex: (index: number) => string;
  start: string;
  stop: string;
  rest: string;
  inScaleOptgroup: (scale: string, mode: string) => string;
  outOfScaleOptgroup: string;
  inScaleDegree: (degree: number | null) => string;
  outOfScale: string;
  pianoRolls: string;
  addPianoRoll: string;
  pianoRollWithIndex: (index: number) => string;
  inScaleHighlightInfo: (scale: string, mode: string) => string;
  midiControllers: (count: number) => string;
  addController: string;
  noControllersHint: string;
  controllerWithIndex: (index: number) => string;
  controllerNumber: string;
  value: string;
  clickDragHint: string;
  playhead: (playhead: number, stepCount: number) => string;
  cycle: (cycle: number) => string;
  midiInput: (name: string) => string;
  none: string;
  resetPlayhead: string;
  allNotesOff: string;
};

const MODE_LABELS: Record<GuiLanguage, Record<SequencerMode, string>> = {
  english: {
    ionian: "Ionian",
    dorian: "Dorian",
    phrygian: "Phrygian",
    lydian: "Lydian",
    mixolydian: "Mixolydian",
    aeolian: "Aeolian",
    locrian: "Locrian"
  },
  german: {
    ionian: "Ionisch",
    dorian: "Dorisch",
    phrygian: "Phrygisch",
    lydian: "Lydisch",
    mixolydian: "Mixolydisch",
    aeolian: "Aeolisch",
    locrian: "Lokrisch"
  },
  french: {
    ionian: "Ionien",
    dorian: "Dorien",
    phrygian: "Phrygien",
    lydian: "Lydien",
    mixolydian: "Mixolydien",
    aeolian: "Aeolien",
    locrian: "Locrien"
  },
  spanish: {
    ionian: "Ionico",
    dorian: "Dorico",
    phrygian: "Frigio",
    lydian: "Lidio",
    mixolydian: "Mixolidio",
    aeolian: "Eolico",
    locrian: "Locrio"
  }
};

const SCALE_TYPE_LABELS: Record<GuiLanguage, Record<SequencerScaleType, string>> = {
  english: { major: "major", neutral: "", minor: "minor" },
  german: { major: "dur", neutral: "", minor: "moll" },
  french: { major: "majeur", neutral: "", minor: "mineur" },
  spanish: { major: "mayor", neutral: "", minor: "menor" }
};

const SEQUENCER_UI_COPY: Record<GuiLanguage, SequencerUiCopy> = {
  english: {
    keyboardInfo: "7 octaves keyboard (C1..B7).",
    scrollKeyboardLeft: "Scroll keyboard left",
    scrollKeyboardRight: "Scroll keyboard right",
    controllerKnobValue: (value) => `Controller knob value ${value}`,
    trackQueuedStart: "starting @ step 1",
    trackQueuedStop: "stopping @ step 1",
    running: "running",
    stopped: "stopped",
    instrumentRack: "Instrument Rack",
    state: "state",
    performanceName: "Performance Name",
    performanceNamePlaceholder: "Live Set A",
    description: "Description",
    performanceDescriptionPlaceholder: "Stage-ready configuration",
    loadPerformance: "Load Performance",
    current: "Current",
    addInstrument: "Add Instrument",
    savePerformance: "Save Performance",
    export: "Export",
    import: "Import",
    noInstrumentHint: "Add at least one saved instrument to start the engine.",
    patch: (index) => `Patch ${index}`,
    channel: "Channel",
    remove: "Remove",
    rackTransport: "Rack Transport",
    startInstruments: "Start Instruments",
    stopInstruments: "Stop Instruments",
    sequencers: "Sequencers",
    addSequencer: "Add Sequencer",
    globalSequencerClock: "Global Sequencer Clock",
    bpm: "BPM",
    midiChannel: "MIDI Channel",
    scale: "Scale",
    mode: "Mode",
    steps: "Steps",
    notesInScaleMode: (scale, mode) => `Notes in ${scale} / ${mode}`,
    patternPads: "Pattern Pads",
    sequencerWithIndex: (index) => `Sequencer ${index}`,
    start: "Start",
    stop: "Stop",
    rest: "Rest",
    inScaleOptgroup: (scale, mode) => `In scale: ${scale} / ${mode}`,
    outOfScaleOptgroup: "Out of scale",
    inScaleDegree: (degree) => `in scale (${degree ?? "-"})`,
    outOfScale: "out of scale",
    pianoRolls: "Piano Rolls",
    addPianoRoll: "Add Piano Roll",
    pianoRollWithIndex: (index) => `Piano Roll ${index}`,
    inScaleHighlightInfo: (scale, mode) =>
      `In-scale notes for ${scale} / ${mode} are highlighted with degrees.`,
    midiControllers: (count) => `MIDI Controllers (${count}/16)`,
    addController: "Add Controller",
    noControllersHint: "Add a MIDI controller to send CC values.",
    controllerWithIndex: (index) => `Controller ${index}`,
    controllerNumber: "Controller #",
    value: "Value",
    clickDragHint: "click + drag up/down",
    playhead: (playhead, stepCount) => `playhead: ${playhead + 1}/${stepCount}`,
    cycle: (cycle) => `cycle: ${cycle}`,
    midiInput: (name) => `midi input: ${name}`,
    none: "none",
    resetPlayhead: "Reset Playhead",
    allNotesOff: "All Notes Off"
  },
  german: {
    keyboardInfo: "7-Oktaven-Tastatur (C1..B7).",
    scrollKeyboardLeft: "Tastatur nach links scrollen",
    scrollKeyboardRight: "Tastatur nach rechts scrollen",
    controllerKnobValue: (value) => `Controller-Wert ${value}`,
    trackQueuedStart: "startet bei Schritt 1",
    trackQueuedStop: "stoppt bei Schritt 1",
    running: "laeuft",
    stopped: "gestoppt",
    instrumentRack: "Instrument-Rack",
    state: "status",
    performanceName: "Performance-Name",
    performanceNamePlaceholder: "Live Set A",
    description: "Beschreibung",
    performanceDescriptionPlaceholder: "Buehnentaugliche Konfiguration",
    loadPerformance: "Performance laden",
    current: "Aktuell",
    addInstrument: "Instrument hinzufuegen",
    savePerformance: "Performance speichern",
    export: "Export",
    import: "Import",
    noInstrumentHint: "Fuege mindestens ein gespeichertes Instrument hinzu, um die Engine zu starten.",
    patch: (index) => `Patch ${index}`,
    channel: "Kanal",
    remove: "Entfernen",
    rackTransport: "Rack-Transport",
    startInstruments: "Instrumente starten",
    stopInstruments: "Instrumente stoppen",
    sequencers: "Sequencer",
    addSequencer: "Sequencer hinzufuegen",
    globalSequencerClock: "Globale Sequencer-Clock",
    bpm: "BPM",
    midiChannel: "MIDI-Kanal",
    scale: "Skala",
    mode: "Modus",
    steps: "Schritte",
    notesInScaleMode: (scale, mode) => `Noten in ${scale} / ${mode}`,
    patternPads: "Pattern-Pads",
    sequencerWithIndex: (index) => `Sequencer ${index}`,
    start: "Start",
    stop: "Stop",
    rest: "Pause",
    inScaleOptgroup: (scale, mode) => `In Skala: ${scale} / ${mode}`,
    outOfScaleOptgroup: "Ausserhalb der Skala",
    inScaleDegree: (degree) => `in skala (${degree ?? "-"})`,
    outOfScale: "ausserhalb der skala",
    pianoRolls: "Piano Rolls",
    addPianoRoll: "Piano Roll hinzufuegen",
    pianoRollWithIndex: (index) => `Piano Roll ${index}`,
    inScaleHighlightInfo: (scale, mode) =>
      `Skalentreue Noten fuer ${scale} / ${mode} sind mit Stufen markiert.`,
    midiControllers: (count) => `MIDI-Controller (${count}/16)`,
    addController: "Controller hinzufuegen",
    noControllersHint: "Fuege einen MIDI-Controller hinzu, um CC-Werte zu senden.",
    controllerWithIndex: (index) => `Controller ${index}`,
    controllerNumber: "Controller #",
    value: "Wert",
    clickDragHint: "klicken + nach oben/unten ziehen",
    playhead: (playhead, stepCount) => `playhead: ${playhead + 1}/${stepCount}`,
    cycle: (cycle) => `zyklus: ${cycle}`,
    midiInput: (name) => `midi eingang: ${name}`,
    none: "kein",
    resetPlayhead: "Playhead zuruecksetzen",
    allNotesOff: "Alle Noten aus"
  },
  french: {
    keyboardInfo: "Clavier 7 octaves (C1..B7).",
    scrollKeyboardLeft: "Defiler clavier a gauche",
    scrollKeyboardRight: "Defiler clavier a droite",
    controllerKnobValue: (value) => `Valeur du controleur ${value}`,
    trackQueuedStart: "demarrage au pas 1",
    trackQueuedStop: "arret au pas 1",
    running: "en cours",
    stopped: "arrete",
    instrumentRack: "Rack instrument",
    state: "etat",
    performanceName: "Nom de performance",
    performanceNamePlaceholder: "Live Set A",
    description: "Description",
    performanceDescriptionPlaceholder: "Configuration prete pour la scene",
    loadPerformance: "Charger performance",
    current: "Actuel",
    addInstrument: "Ajouter instrument",
    savePerformance: "Enregistrer performance",
    export: "Exporter",
    import: "Importer",
    noInstrumentHint: "Ajoutez au moins un instrument sauvegarde pour demarrer le moteur.",
    patch: (index) => `Patch ${index}`,
    channel: "Canal",
    remove: "Supprimer",
    rackTransport: "Transport du rack",
    startInstruments: "Demarrer instruments",
    stopInstruments: "Arreter instruments",
    sequencers: "Sequenceurs",
    addSequencer: "Ajouter sequenceur",
    globalSequencerClock: "Horloge globale du sequenceur",
    bpm: "BPM",
    midiChannel: "Canal MIDI",
    scale: "Gamme",
    mode: "Mode",
    steps: "Pas",
    notesInScaleMode: (scale, mode) => `Notes dans ${scale} / ${mode}`,
    patternPads: "Pads de pattern",
    sequencerWithIndex: (index) => `Sequenceur ${index}`,
    start: "Demarrer",
    stop: "Arreter",
    rest: "Silence",
    inScaleOptgroup: (scale, mode) => `Dans la gamme: ${scale} / ${mode}`,
    outOfScaleOptgroup: "Hors gamme",
    inScaleDegree: (degree) => `dans gamme (${degree ?? "-"})`,
    outOfScale: "hors gamme",
    pianoRolls: "Piano Rolls",
    addPianoRoll: "Ajouter piano roll",
    pianoRollWithIndex: (index) => `Piano Roll ${index}`,
    inScaleHighlightInfo: (scale, mode) =>
      `Les notes dans la gamme pour ${scale} / ${mode} sont surlignees avec les degres.`,
    midiControllers: (count) => `Controleurs MIDI (${count}/16)`,
    addController: "Ajouter controleur",
    noControllersHint: "Ajoutez un controleur MIDI pour envoyer des valeurs CC.",
    controllerWithIndex: (index) => `Controleur ${index}`,
    controllerNumber: "Controleur #",
    value: "Valeur",
    clickDragHint: "cliquer + glisser haut/bas",
    playhead: (playhead, stepCount) => `playhead: ${playhead + 1}/${stepCount}`,
    cycle: (cycle) => `cycle: ${cycle}`,
    midiInput: (name) => `entree midi: ${name}`,
    none: "aucune",
    resetPlayhead: "Reinitialiser playhead",
    allNotesOff: "Toutes notes off"
  },
  spanish: {
    keyboardInfo: "Teclado de 7 octavas (C1..B7).",
    scrollKeyboardLeft: "Desplazar teclado a la izquierda",
    scrollKeyboardRight: "Desplazar teclado a la derecha",
    controllerKnobValue: (value) => `Valor de perilla ${value}`,
    trackQueuedStart: "inicia en paso 1",
    trackQueuedStop: "detiene en paso 1",
    running: "ejecutando",
    stopped: "detenido",
    instrumentRack: "Rack de instrumentos",
    state: "estado",
    performanceName: "Nombre de performance",
    performanceNamePlaceholder: "Live Set A",
    description: "Descripcion",
    performanceDescriptionPlaceholder: "Configuracion lista para escenario",
    loadPerformance: "Cargar performance",
    current: "Actual",
    addInstrument: "Agregar instrumento",
    savePerformance: "Guardar performance",
    export: "Exportar",
    import: "Importar",
    noInstrumentHint: "Agrega al menos un instrumento guardado para iniciar el motor.",
    patch: (index) => `Patch ${index}`,
    channel: "Canal",
    remove: "Eliminar",
    rackTransport: "Transporte del rack",
    startInstruments: "Iniciar instrumentos",
    stopInstruments: "Detener instrumentos",
    sequencers: "Secuenciadores",
    addSequencer: "Agregar secuenciador",
    globalSequencerClock: "Reloj global del secuenciador",
    bpm: "BPM",
    midiChannel: "Canal MIDI",
    scale: "Escala",
    mode: "Modo",
    steps: "Pasos",
    notesInScaleMode: (scale, mode) => `Notas en ${scale} / ${mode}`,
    patternPads: "Pads de patron",
    sequencerWithIndex: (index) => `Secuenciador ${index}`,
    start: "Iniciar",
    stop: "Detener",
    rest: "Silencio",
    inScaleOptgroup: (scale, mode) => `En escala: ${scale} / ${mode}`,
    outOfScaleOptgroup: "Fuera de escala",
    inScaleDegree: (degree) => `en escala (${degree ?? "-"})`,
    outOfScale: "fuera de escala",
    pianoRolls: "Piano Rolls",
    addPianoRoll: "Agregar piano roll",
    pianoRollWithIndex: (index) => `Piano Roll ${index}`,
    inScaleHighlightInfo: (scale, mode) =>
      `Las notas en escala para ${scale} / ${mode} se resaltan con grados.`,
    midiControllers: (count) => `Controladores MIDI (${count}/16)`,
    addController: "Agregar controlador",
    noControllersHint: "Agrega un controlador MIDI para enviar valores CC.",
    controllerWithIndex: (index) => `Controlador ${index}`,
    controllerNumber: "Controlador #",
    value: "Valor",
    clickDragHint: "clic + arrastrar arriba/abajo",
    playhead: (playhead, stepCount) => `playhead: ${playhead + 1}/${stepCount}`,
    cycle: (cycle) => `ciclo: ${cycle}`,
    midiInput: (name) => `entrada midi: ${name}`,
    none: "ninguna",
    resetPlayhead: "Reiniciar playhead",
    allNotesOff: "Todas las notas off"
  }
};

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
  ui: SequencerUiCopy;
  roll: PianoRollState;
  instrumentsRunning: boolean;
  onNoteOn: (note: number, channel: number) => void;
  onNoteOff: (note: number, channel: number) => void;
}

function PianoRollKeyboard({ ui, roll, instrumentsRunning, onNoteOn, onNoteOff }: PianoRollKeyboardProps) {
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
  ariaLabel: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

function MidiControllerKnob({ ariaLabel, value, disabled, onChange }: MidiControllerKnobProps) {
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
      aria-label={ariaLabel}
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
  guiLanguage: GuiLanguage;
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
  onHelpRequest?: (helpDocId: HelpDocId) => void;
}

function trackStateLabel(track: SequencerTrackState, ui: Pick<SequencerUiCopy, "trackQueuedStart" | "trackQueuedStop" | "running" | "stopped">): string {
  if (track.queuedEnabled === true) {
    return ui.trackQueuedStart;
  }
  if (track.queuedEnabled === false) {
    return ui.trackQueuedStop;
  }
  return track.enabled ? ui.running : ui.stopped;
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
  guiLanguage,
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
  onAllNotesOff,
  onHelpRequest
}: SequencerPageProps) {
  const ui = SEQUENCER_UI_COPY[guiLanguage];
  const modeLabels = MODE_LABELS[guiLanguage];
  const scaleTypeLabels = SCALE_TYPE_LABELS[guiLanguage];
  const modeOptions = useMemo(
    () =>
      SEQUENCER_MODE_OPTIONS.map((option) => ({
        ...option,
        label: modeLabels[option.value]
      })),
    [modeLabels]
  );
  const scaleOptions = useMemo(
    () =>
      SEQUENCER_SCALE_OPTIONS.map((option) => ({
        ...option,
        label: scaleTypeLabels[option.type].length > 0 ? `${option.root} ${scaleTypeLabels[option.type]}` : option.root
      })),
    [scaleTypeLabels]
  );
  const localizedSessionState = useMemo(() => {
    if (sessionState === "running") {
      return ui.running;
    }
    if (sessionState === "idle") {
      return ui.stopped;
    }
    return sessionState;
  }, [sessionState, ui.running, ui.stopped]);

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

      <div className="relative rounded-xl border border-cyan-800/45 bg-slate-950/85 p-3">
        {onHelpRequest ? (
          <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("sequencer_instrument_rack")} />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-200">{ui.instrumentRack}</div>
          <div className="ml-auto mr-10 rounded-full border border-slate-700 bg-slate-950 px-3 py-1 font-mono text-xs text-slate-300">
            {ui.state}: {localizedSessionState}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1 lg:col-span-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{ui.performanceName}</span>
            <input
              value={performanceName}
              onChange={(event) => onPerformanceNameChange(event.target.value)}
              placeholder={ui.performanceNamePlaceholder}
              className="rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring"
            />
          </label>

          <label className="flex flex-col gap-1 lg:col-span-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{ui.description}</span>
            <input
              value={performanceDescription}
              onChange={(event) => onPerformanceDescriptionChange(event.target.value)}
              placeholder={ui.performanceDescriptionPlaceholder}
              className="rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{ui.loadPerformance}</span>
            <select
              value={currentPerformanceId ?? ""}
              onChange={(event) => {
                if (event.target.value.length > 0) {
                  onLoadPerformance(event.target.value);
                }
              }}
              className="rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring"
            >
              <option value="">{ui.current}</option>
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
            {ui.addInstrument}
          </button>
          <button
            type="button"
            onClick={onSavePerformance}
            className="rounded-md border border-mint/55 bg-mint/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-mint transition hover:bg-mint/25"
          >
            {ui.savePerformance}
          </button>
          <button
            type="button"
            onClick={onExportConfig}
            className="rounded-md border border-slate-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
          >
            {ui.export}
          </button>
          <button
            type="button"
            onClick={triggerConfigLoad}
            className="rounded-md border border-slate-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
          >
            {ui.import}
          </button>
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
          {instrumentBindings.length === 0 ? (
            <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
              {ui.noInstrumentHint}
            </div>
          ) : (
            instrumentBindings.map((binding, index) => (
              <div
                key={binding.id}
                className="grid grid-cols-[minmax(0,_1fr)_88px_auto] items-end gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-2"
              >
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">{ui.patch(index + 1)}</span>
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
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">{ui.channel}</span>
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
                  {ui.remove}
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 rounded-lg border border-cyan-900/55 bg-slate-900/65 p-2.5">
          <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">{ui.rackTransport}</div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onStartInstruments}
              disabled={instrumentsRunning}
              className={transportStartButtonClass}
            >
              {ui.startInstruments}
            </button>
            <button
              type="button"
              onClick={onStopInstruments}
              disabled={!instrumentsRunning}
              className={transportStopButtonClass}
            >
              {ui.stopInstruments}
            </button>
            <span className={transportStateClass}>{instrumentsRunning ? ui.running : ui.stopped}</span>
          </div>
        </div>
      </div>

      {transportError && (
        <div className="mt-3 rounded-xl border border-rose-500/60 bg-rose-950/50 px-3 py-2 font-mono text-xs text-rose-200">
          {transportError}
        </div>
      )}

      <div className="relative mt-4 rounded-xl border border-sky-800/45 bg-slate-950/85 p-3">
        {onHelpRequest ? (
          <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("sequencer_tracks")} />
        ) : null}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-sky-200">{ui.sequencers}</div>
          <button
            type="button"
            onClick={onAddSequencerTrack}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25"
          >
            {ui.addSequencer}
          </button>
        </div>

        <div className="mb-3 rounded-lg border border-sky-900/55 bg-slate-900/65 p-2.5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{ui.globalSequencerClock}</div>
            <span className={transportStateClass}>{sequencer.isPlaying ? ui.running : ui.stopped}</span>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className={controlLabelClass}>{ui.bpm}</span>
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
            const scaleLabel =
              scaleTypeLabels[track.scaleType].length > 0
                ? `${track.scaleRoot} ${scaleTypeLabels[track.scaleType]}`
                : track.scaleRoot;
            const modeLabel = modeLabels[track.mode];
            const scaleValue = `${track.scaleRoot}:${track.scaleType}`;
            const stepIndices = Array.from({ length: track.stepCount }, (_, index) => index);

            return (
              <article key={track.id} className="rounded-xl border border-slate-700 bg-slate-900/65 p-2.5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">
                    {track.name || ui.sequencerWithIndex(trackIndex + 1)}
                  </div>
                  <span className={transportStateClass}>{trackStateLabel(track, ui)}</span>
                  <button
                    type="button"
                    onClick={() => onSequencerTrackEnabledChange(track.id, !track.enabled)}
                    disabled={!instrumentsRunning && !track.enabled}
                    className={track.enabled ? transportStopButtonClass : transportStartButtonClass}
                  >
                    {track.enabled ? ui.stop : ui.start}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveSequencerTrack(track.id)}
                    className="rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25"
                  >
                    {ui.remove}
                  </button>
                </div>

                <div className="mb-2 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className={controlLabelClass}>{ui.midiChannel}</span>
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
                    <span className={controlLabelClass}>{ui.scale}</span>
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
                      {scaleOptions.map((option) => (
                        <option key={`${track.id}-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex min-w-[160px] flex-col gap-1">
                    <span className={controlLabelClass}>{ui.mode}</span>
                    <select
                      value={track.mode}
                      onChange={(event) => onSequencerTrackModeChange(track.id, event.target.value as SequencerMode)}
                      className={controlFieldClass}
                    >
                      {modeOptions.map((option) => (
                        <option key={`${track.id}-mode-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex flex-col gap-1">
                    <span className={controlLabelClass}>{ui.steps}</span>
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
                  {ui.notesInScaleMode(scaleLabel, modeLabel)}
                </div>

                <div className="mb-2">
                  <div className="mb-1 text-xs uppercase tracking-[0.2em] text-slate-400">{ui.patternPads}</div>
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
                      const selectedLabel =
                        noteValue === null ? ui.rest : pianoKeyPrimaryLabel(selectedNote?.label, noteValue);

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
                                {ui.rest}
                              </option>
                              <optgroup label={ui.inScaleOptgroup(scaleLabel, modeLabel)}>
                                {inScaleOptions.map((option) => (
                                  <option key={`${track.id}-in-${option.note}`} value={option.note} style={{ color: "#f8fafc" }}>
                                    {option.label}
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label={ui.outOfScaleOptgroup}>
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
                            {noteValue === null ? ui.rest.toLowerCase() : isInScale ? ui.inScaleDegree(degree) : ui.outOfScale}
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

      <div className="relative mt-4 rounded-xl border border-emerald-800/45 bg-slate-950/85 p-3">
        {onHelpRequest ? (
          <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("sequencer_piano_rolls")} />
        ) : null}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200">{ui.pianoRolls}</div>
          <button
            type="button"
            onClick={onAddPianoRoll}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25"
          >
            {ui.addPianoRoll}
          </button>
        </div>

        <div className="space-y-3">
          {sequencer.pianoRolls.map((roll, rollIndex) => {
            const scaleValue = `${roll.scaleRoot}:${roll.scaleType}`;
            const scaleLabel =
              scaleTypeLabels[roll.scaleType].length > 0
                ? `${roll.scaleRoot} ${scaleTypeLabels[roll.scaleType]}`
                : roll.scaleRoot;
            const modeLabel = modeLabels[roll.mode];
            return (
              <article key={roll.id} className="rounded-xl border border-slate-700 bg-slate-900/65 p-2.5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">
                    {roll.name || ui.pianoRollWithIndex(rollIndex + 1)}
                  </div>
                  <span className={transportStateClass}>{roll.enabled ? ui.running : ui.stopped}</span>
                  <button
                    type="button"
                    onClick={() => onPianoRollEnabledChange(roll.id, !roll.enabled)}
                    disabled={!instrumentsRunning && !roll.enabled}
                    className={roll.enabled ? transportStopButtonClass : transportStartButtonClass}
                  >
                    {roll.enabled ? ui.stop : ui.start}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemovePianoRoll(roll.id)}
                    className="rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25"
                  >
                    {ui.remove}
                  </button>
                </div>

                <div className="mb-2 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className={controlLabelClass}>{ui.midiChannel}</span>
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
                    <span className={controlLabelClass}>{ui.scale}</span>
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
                      {scaleOptions.map((option) => (
                        <option key={`${roll.id}-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-[160px] flex-col gap-1">
                    <span className={controlLabelClass}>{ui.mode}</span>
                    <select
                      value={roll.mode}
                      onChange={(event) => onPianoRollModeChange(roll.id, event.target.value as SequencerMode)}
                      className={controlFieldClass}
                    >
                      {modeOptions.map((option) => (
                        <option key={`${roll.id}-mode-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mb-2 text-[11px] text-slate-500">
                  {ui.inScaleHighlightInfo(scaleLabel, modeLabel)}
                </div>

                <div className="relative left-1/2 w-screen -translate-x-1/2 px-4 sm:px-6 lg:px-8">
                  <PianoRollKeyboard
                    ui={ui}
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

      <div className="relative mt-4 rounded-xl border border-violet-800/45 bg-slate-950/85 p-3">
        {onHelpRequest ? (
          <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("sequencer_midi_controllers")} />
        ) : null}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-violet-200">
            {ui.midiControllers(sequencer.midiControllers.length)}
          </div>
          <button
            type="button"
            onClick={onAddMidiController}
            disabled={sequencer.midiControllers.length >= 16}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ui.addController}
          </button>
        </div>

        {sequencer.midiControllers.length === 0 ? (
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
            {ui.noControllersHint}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {sequencer.midiControllers.map((controller, controllerIndex) => (
              <article key={controller.id} className="rounded-xl border border-slate-700 bg-slate-900/65 p-2.5">
                <div className="mb-2 flex items-center gap-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">
                    {controller.name || ui.controllerWithIndex(controllerIndex + 1)}
                  </div>
                  <span className={transportStateClass}>{controller.enabled ? ui.running : ui.stopped}</span>
                </div>

                <div className="mb-2 flex flex-wrap items-end gap-2">
                  <label className="flex min-w-[120px] flex-col gap-1">
                    <span className={controlLabelClass}>{ui.controllerNumber}</span>
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
                    {controller.enabled ? ui.stop : ui.start}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveMidiController(controller.id)}
                    className="rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25"
                  >
                    {ui.remove}
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <MidiControllerKnob
                    ariaLabel={ui.controllerKnobValue(controller.value)}
                    value={controller.value}
                    disabled={false}
                    onChange={(value) => onMidiControllerValueChange(controller.id, value)}
                  />
                  <div className="space-y-1">
                    <div className={controlLabelClass}>{ui.value}</div>
                    <div className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100">
                      {controller.value}
                    </div>
                    <div className="text-[10px] text-slate-500">{ui.clickDragHint}</div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-xs text-slate-300">
        <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
          {ui.playhead(sequencer.playhead, sequencer.stepCount)}
        </span>
        <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
          {ui.cycle(sequencer.cycle)}
        </span>
        <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
          {ui.midiInput(midiInputName ?? ui.none)}
        </span>
        <button
          type="button"
          onClick={onResetPlayhead}
          className="rounded-lg border border-slate-500 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
        >
          {ui.resetPlayhead}
        </button>
        <button
          type="button"
          onClick={onAllNotesOff}
          className="rounded-lg border border-amber-400/50 bg-amber-400/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-200 transition hover:bg-amber-400/30"
        >
          {ui.allNotesOff}
        </button>
      </div>
    </section>
  );
}
