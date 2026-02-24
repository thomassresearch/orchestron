import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";

import {
  buildControllerCurvePath,
  buildSequencerNoteOptions,
  CONTROLLER_SEQUENCER_STEP_OPTIONS,
  parseSequencerScaleValue,
  sampleControllerCurveValue,
  scaleDegreeForNote,
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
  ControllerSequencerKeypoint,
  ControllerSequencerState,
  SequencerInstrumentBinding,
  SequencerMode,
  SequencerScaleRoot,
  SequencerScaleType,
  SequencerState,
  SequencerStepState,
  SequencerTrackState
} from "../types";

const PIANO_ROLL_START_NOTE = 24; // C1
const PIANO_ROLL_NOTE_COUNT = 84; // C1..B7
const PIANO_WHITE_KEY_WIDTH = 36;
const PIANO_WHITE_KEY_HEIGHT = 132;
const PIANO_BLACK_KEY_WIDTH = 22;
const PIANO_BLACK_KEY_HEIGHT = 84;
const PIANO_SCROLL_STEP_PX = PIANO_WHITE_KEY_WIDTH * 8;
const MIXED_SELECT_VALUE = "__mixed__";
const SEQUENCER_PAD_DRAG_MIME = "application/x-visualcsound-sequencer-pad";
const PAD_TRANSPOSE_LONG_PRESS_MS = 350;

type SequencerPadDragPayload = {
  trackId: string;
  padIndex: number;
};

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
  clonePerformance: string;
  deletePerformance: string;
  export: string;
  import: string;
  noInstrumentHint: string;
  patch: (index: number) => string;
  channel: string;
  remove: string;
  clearSteps: string;
  rackTransport: string;
  startInstruments: string;
  stopInstruments: string;
  startAll: string;
  stopAll: string;
  sequencers: string;
  addSequencer: string;
  addControllerSequencer: string;
  globalSequencerClock: string;
  bpm: string;
  midiChannel: string;
  scale: string;
  mode: string;
  steps: string;
  on: string;
  off: string;
  padLooper: string;
  repeat: string;
  padLoopSequence: string;
  padLoopSequenceEmpty: string;
  padLoopSequenceHint: string;
  removePadLoopStep: (padNumber: number) => string;
  notesInScaleMode: (scale: string, mode: string) => string;
  patternPads: string;
  sequencerWithIndex: (index: number) => string;
  start: string;
  stop: string;
  rest: string;
  hold: string;
  octave: string;
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
  curveRate: string;
  controllerSequencerWithIndex: (index: number) => string;
  curveEditorHint: string;
  removeCurvePoint: string;
  clickDragHint: string;
  playhead: (playhead: number, stepCount: number) => string;
  cycle: (cycle: number) => string;
  midiInput: (name: string) => string;
  none: string;
  mixed: string;
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
    clonePerformance: "Clone",
    deletePerformance: "Delete",
    export: "Export",
    import: "Import",
    noInstrumentHint: "Add at least one saved instrument to start the engine.",
    patch: (index) => `Patch ${index}`,
    channel: "Channel",
    remove: "Remove",
    clearSteps: "Clear Steps",
    rackTransport: "Rack Transport",
    startInstruments: "Start Instruments",
    stopInstruments: "Stop Instruments",
    startAll: "Start All",
    stopAll: "Stop All",
    sequencers: "Sequencers",
    addSequencer: "Add Sequencer",
    addControllerSequencer: "Add Controller Sequencer",
    globalSequencerClock: "Global Sequencer Clock",
    bpm: "BPM",
    midiChannel: "MIDI Channel",
    scale: "Scale",
    mode: "Mode",
    steps: "Steps",
    on: "On",
    off: "Off",
    padLooper: "Pad Looper",
    repeat: "Repeat",
    padLoopSequence: "Pad Sequence",
    padLoopSequenceEmpty: "Click here, press 1-8, or drop pads",
    padLoopSequenceHint: "1-8 / drop pads",
    removePadLoopStep: (padNumber) => `Remove pad ${padNumber} from sequence`,
    notesInScaleMode: (scale, mode) => `Notes in ${scale} / ${mode}`,
    patternPads: "Pattern Pads",
    sequencerWithIndex: (index) => `Sequencer ${index}`,
    start: "Start",
    stop: "Stop",
    rest: "Rest",
    hold: "HOLD",
    octave: "Octave",
    inScaleOptgroup: (scale, mode) => `In scale: ${scale} / ${mode}`,
    outOfScaleOptgroup: "Out of scale",
    inScaleDegree: (degree) => `in scale (${degree ?? "-"})`,
    outOfScale: "out of scale",
    pianoRolls: "Piano Rolls",
    addPianoRoll: "Add Piano Roll",
    pianoRollWithIndex: (index) => `Piano Roll ${index}`,
    inScaleHighlightInfo: (scale, mode) =>
      `In-scale notes for ${scale} / ${mode} are highlighted with degrees.`,
    midiControllers: (count) => `MIDI Controllers (${count}/6)`,
    addController: "Add Controller",
    noControllersHint: "Add a MIDI controller to send CC values.",
    controllerWithIndex: (index) => `Controller ${index}`,
    controllerSequencerWithIndex: (index) => `Controller Sequencer ${index}`,
    controllerNumber: "Controller #",
    value: "Value",
    curveRate: "Curve Rate",
    curveEditorHint: "click to add points, drag vertically, double-click a point to remove",
    removeCurvePoint: "Remove curve point",
    clickDragHint: "click + drag up/down",
    playhead: (playhead, stepCount) => `playhead: ${playhead + 1}/${stepCount}`,
    cycle: (cycle) => `cycle: ${cycle}`,
    midiInput: (name) => `midi input: ${name}`,
    none: "none",
    mixed: "mixed",
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
    clonePerformance: "Klonen",
    deletePerformance: "Loeschen",
    export: "Export",
    import: "Import",
    noInstrumentHint: "Fuege mindestens ein gespeichertes Instrument hinzu, um die Engine zu starten.",
    patch: (index) => `Patch ${index}`,
    channel: "Kanal",
    remove: "Entfernen",
    clearSteps: "Steps loeschen",
    rackTransport: "Rack-Transport",
    startInstruments: "Instrumente starten",
    stopInstruments: "Instrumente stoppen",
    startAll: "Alles starten",
    stopAll: "Alles stoppen",
    sequencers: "Sequencer",
    addSequencer: "Sequencer hinzufuegen",
    addControllerSequencer: "Controller-Sequencer hinzufuegen",
    globalSequencerClock: "Globale Sequencer-Clock",
    bpm: "BPM",
    midiChannel: "MIDI-Kanal",
    scale: "Skala",
    mode: "Modus",
    steps: "Schritte",
    on: "An",
    off: "Aus",
    padLooper: "Pad-Looper",
    repeat: "Repeat",
    padLoopSequence: "Pad-Sequenz",
    padLoopSequenceEmpty: "Hier klicken, 1-8 druecken oder Pads ablegen",
    padLoopSequenceHint: "1-8 / Pads ablegen",
    removePadLoopStep: (padNumber) => `Pad ${padNumber} aus Sequenz entfernen`,
    notesInScaleMode: (scale, mode) => `Noten in ${scale} / ${mode}`,
    patternPads: "Pattern-Pads",
    sequencerWithIndex: (index) => `Sequencer ${index}`,
    start: "Start",
    stop: "Stop",
    rest: "Pause",
    hold: "HOLD",
    octave: "Oktave",
    inScaleOptgroup: (scale, mode) => `In Skala: ${scale} / ${mode}`,
    outOfScaleOptgroup: "Ausserhalb der Skala",
    inScaleDegree: (degree) => `in skala (${degree ?? "-"})`,
    outOfScale: "ausserhalb der skala",
    pianoRolls: "Piano Rolls",
    addPianoRoll: "Piano Roll hinzufuegen",
    pianoRollWithIndex: (index) => `Piano Roll ${index}`,
    inScaleHighlightInfo: (scale, mode) =>
      `Skalentreue Noten fuer ${scale} / ${mode} sind mit Stufen markiert.`,
    midiControllers: (count) => `MIDI-Controller (${count}/6)`,
    addController: "Controller hinzufuegen",
    noControllersHint: "Fuege einen MIDI-Controller hinzu, um CC-Werte zu senden.",
    controllerWithIndex: (index) => `Controller ${index}`,
    controllerSequencerWithIndex: (index) => `Controller-Sequencer ${index}`,
    controllerNumber: "Controller #",
    value: "Wert",
    curveRate: "Kurvenrate",
    curveEditorHint: "Klicken, um Punkte zu setzen; vertikal ziehen; Doppelklick entfernt",
    removeCurvePoint: "Kurvenpunkt entfernen",
    clickDragHint: "klicken + nach oben/unten ziehen",
    playhead: (playhead, stepCount) => `playhead: ${playhead + 1}/${stepCount}`,
    cycle: (cycle) => `zyklus: ${cycle}`,
    midiInput: (name) => `midi eingang: ${name}`,
    none: "kein",
    mixed: "gemischt",
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
    clonePerformance: "Cloner",
    deletePerformance: "Supprimer",
    export: "Exporter",
    import: "Importer",
    noInstrumentHint: "Ajoutez au moins un instrument sauvegarde pour demarrer le moteur.",
    patch: (index) => `Patch ${index}`,
    channel: "Canal",
    remove: "Supprimer",
    clearSteps: "Effacer pas",
    rackTransport: "Transport du rack",
    startInstruments: "Demarrer instruments",
    stopInstruments: "Arreter instruments",
    startAll: "Tout demarrer",
    stopAll: "Tout arreter",
    sequencers: "Sequenceurs",
    addSequencer: "Ajouter sequenceur",
    addControllerSequencer: "Ajouter sequenceur controleur",
    globalSequencerClock: "Horloge globale du sequenceur",
    bpm: "BPM",
    midiChannel: "Canal MIDI",
    scale: "Gamme",
    mode: "Mode",
    steps: "Pas",
    on: "On",
    off: "Off",
    padLooper: "Looper de pads",
    repeat: "Repeat",
    padLoopSequence: "Sequence de pads",
    padLoopSequenceEmpty: "Cliquez ici, appuyez 1-8, ou deposez des pads",
    padLoopSequenceHint: "1-8 / deposer pads",
    removePadLoopStep: (padNumber) => `Retirer pad ${padNumber} de la sequence`,
    notesInScaleMode: (scale, mode) => `Notes dans ${scale} / ${mode}`,
    patternPads: "Pads de pattern",
    sequencerWithIndex: (index) => `Sequenceur ${index}`,
    start: "Demarrer",
    stop: "Arreter",
    rest: "Silence",
    hold: "HOLD",
    octave: "Octave",
    inScaleOptgroup: (scale, mode) => `Dans la gamme: ${scale} / ${mode}`,
    outOfScaleOptgroup: "Hors gamme",
    inScaleDegree: (degree) => `dans gamme (${degree ?? "-"})`,
    outOfScale: "hors gamme",
    pianoRolls: "Piano Rolls",
    addPianoRoll: "Ajouter piano roll",
    pianoRollWithIndex: (index) => `Piano Roll ${index}`,
    inScaleHighlightInfo: (scale, mode) =>
      `Les notes dans la gamme pour ${scale} / ${mode} sont surlignees avec les degres.`,
    midiControllers: (count) => `Controleurs MIDI (${count}/6)`,
    addController: "Ajouter controleur",
    noControllersHint: "Ajoutez un controleur MIDI pour envoyer des valeurs CC.",
    controllerWithIndex: (index) => `Controleur ${index}`,
    controllerSequencerWithIndex: (index) => `Sequenceur controleur ${index}`,
    controllerNumber: "Controleur #",
    value: "Valeur",
    curveRate: "Vitesse courbe",
    curveEditorHint: "cliquer pour ajouter, glisser verticalement, double-clic pour supprimer",
    removeCurvePoint: "Supprimer point de courbe",
    clickDragHint: "cliquer + glisser haut/bas",
    playhead: (playhead, stepCount) => `playhead: ${playhead + 1}/${stepCount}`,
    cycle: (cycle) => `cycle: ${cycle}`,
    midiInput: (name) => `entree midi: ${name}`,
    none: "aucune",
    mixed: "mixte",
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
    clonePerformance: "Clonar",
    deletePerformance: "Eliminar",
    export: "Exportar",
    import: "Importar",
    noInstrumentHint: "Agrega al menos un instrumento guardado para iniciar el motor.",
    patch: (index) => `Patch ${index}`,
    channel: "Canal",
    remove: "Eliminar",
    clearSteps: "Limpiar pasos",
    rackTransport: "Transporte del rack",
    startInstruments: "Iniciar instrumentos",
    stopInstruments: "Detener instrumentos",
    startAll: "Iniciar todo",
    stopAll: "Detener todo",
    sequencers: "Secuenciadores",
    addSequencer: "Agregar secuenciador",
    addControllerSequencer: "Agregar secuenciador controlador",
    globalSequencerClock: "Reloj global del secuenciador",
    bpm: "BPM",
    midiChannel: "Canal MIDI",
    scale: "Escala",
    mode: "Modo",
    steps: "Pasos",
    on: "On",
    off: "Off",
    padLooper: "Looper de pads",
    repeat: "Repeat",
    padLoopSequence: "Secuencia de pads",
    padLoopSequenceEmpty: "Haz clic aqui, pulsa 1-8 o suelta pads",
    padLoopSequenceHint: "1-8 / soltar pads",
    removePadLoopStep: (padNumber) => `Quitar pad ${padNumber} de la secuencia`,
    notesInScaleMode: (scale, mode) => `Notas en ${scale} / ${mode}`,
    patternPads: "Pads de patron",
    sequencerWithIndex: (index) => `Secuenciador ${index}`,
    start: "Iniciar",
    stop: "Detener",
    rest: "Silencio",
    hold: "HOLD",
    octave: "Octava",
    inScaleOptgroup: (scale, mode) => `En escala: ${scale} / ${mode}`,
    outOfScaleOptgroup: "Fuera de escala",
    inScaleDegree: (degree) => `en escala (${degree ?? "-"})`,
    outOfScale: "fuera de escala",
    pianoRolls: "Piano Rolls",
    addPianoRoll: "Agregar piano roll",
    pianoRollWithIndex: (index) => `Piano Roll ${index}`,
    inScaleHighlightInfo: (scale, mode) =>
      `Las notas en escala para ${scale} / ${mode} se resaltan con grados.`,
    midiControllers: (count) => `Controladores MIDI (${count}/6)`,
    addController: "Agregar controlador",
    noControllersHint: "Agrega un controlador MIDI para enviar valores CC.",
    controllerWithIndex: (index) => `Controlador ${index}`,
    controllerSequencerWithIndex: (index) => `Secuenciador controlador ${index}`,
    controllerNumber: "Controlador #",
    value: "Valor",
    curveRate: "Ritmo curva",
    curveEditorHint: "clic para agregar, arrastrar verticalmente, doble clic para quitar",
    removeCurvePoint: "Quitar punto de curva",
    clickDragHint: "clic + arrastrar arriba/abajo",
    playhead: (playhead, stepCount) => `playhead: ${playhead + 1}/${stepCount}`,
    cycle: (cycle) => `ciclo: ${cycle}`,
    midiInput: (name) => `entrada midi: ${name}`,
    none: "ninguna",
    mixed: "mixto",
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

interface SequencerPitchClassOption {
  pitchClass: number;
  label: string;
  degree: number | null;
  inScale: boolean;
}

function pianoKeyNoteName(label: string | undefined, note: number): string {
  return pianoKeyPrimaryLabel(label, note).replace(/-?\d+$/, "").trim();
}

function midiNotePitchClass(note: number): number {
  return normalizePitchClass(note);
}

function midiNoteOctave(note: number): number {
  return Math.floor(Math.round(note) / 12) - 1;
}

function sequencerMidiNoteFromPitchClassOctave(pitchClass: number, octave: number): number {
  const normalizedPitchClass = normalizePitchClass(pitchClass);
  const normalizedOctave = Math.max(0, Math.min(7, Math.round(octave)));
  return normalizedPitchClass + (normalizedOctave + 1) * 12;
}

function buildSequencerPitchClassOptions(
  noteOptions: Array<{ note: number; label: string; degree: number | null; inScale: boolean }>
): SequencerPitchClassOption[] {
  const byPitchClass = new Map<number, SequencerPitchClassOption>();
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
  return Array.from(byPitchClass.values()).sort((a, b) => a.pitchClass - b.pitchClass);
}

interface PianoRollHighlightTheory {
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

interface PianoRollKeyboardProps {
  ui: SequencerUiCopy;
  roll: PianoRollState;
  instrumentsRunning: boolean;
  highlightTheories: PianoRollHighlightTheory[];
  onNoteOn: (note: number, channel: number) => void;
  onNoteOff: (note: number, channel: number) => void;
}

function PianoRollKeyboard({
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

function clampControllerCurveUiPosition(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function controllerCurveValueToY(value: number, height: number): number {
  const safeHeight = Math.max(1, height);
  return safeHeight - (clampMidiControllerValue(value) / 127) * safeHeight;
}

function controllerCurveYToValue(y: number, height: number): number {
  const safeHeight = Math.max(1, height);
  const normalized = 1 - Math.max(0, Math.min(safeHeight, y)) / safeHeight;
  return clampMidiControllerValue(normalized * 127);
}

interface ControllerSequencerCurveEditorProps {
  ui: Pick<SequencerUiCopy, "curveEditorHint" | "removeCurvePoint">;
  controllerSequencer: ControllerSequencerState;
  playbackTransport:
    | {
        playhead: number;
        cycle: number;
        stepCount: 16 | 32;
        bpm: number;
      }
    | null;
  onAddPoint: (position: number, value: number) => void;
  onPointChange: (keypointId: string, position: number, value: number) => void;
  onPointRemove: (keypointId: string) => void;
}

function ControllerSequencerCurveEditor({
  ui,
  controllerSequencer,
  playbackTransport,
  onAddPoint,
  onPointChange,
  onPointRemove
}: ControllerSequencerCurveEditorProps) {
  const [width, setWidth] = useState(960);
  const height = 150;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<
    | {
        pointerId: number;
        keypointId: string;
        startClientX: number;
        startClientY: number;
        startPosition: number;
        startValue: number;
        dragging: boolean;
      }
    | null
  >(null);
  const transportAnchorRef = useRef<{
    playhead: number;
    cycle: number;
    stepCount: 16 | 32;
    bpm: number;
    timestampMs: number;
  } | null>(null);
  const [playbackNow, setPlaybackNow] = useState<number>(() =>
    typeof performance !== "undefined" ? performance.now() : 0
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.max(320, Math.round(svg.clientWidth || svg.getBoundingClientRect().width || 960));
      setWidth((previous) => (previous === nextWidth ? previous : nextWidth));
    };

    updateWidth();

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(svg);
    return () => {
      observer.disconnect();
    };
  }, []);

  const path = useMemo(
    () => buildControllerCurvePath(controllerSequencer.keypoints, width, height),
    [controllerSequencer.keypoints, height, width]
  );

  useEffect(() => {
    if (!playbackTransport) {
      transportAnchorRef.current = null;
      return;
    }
    transportAnchorRef.current = {
      ...playbackTransport,
      timestampMs: typeof performance !== "undefined" ? performance.now() : Date.now()
    };
  }, [
    playbackTransport?.bpm,
    playbackTransport?.cycle,
    playbackTransport?.playhead,
    playbackTransport?.stepCount
  ]);

  useEffect(() => {
    if (!playbackTransport) {
      return;
    }

    let rafId = 0;
    let cancelled = false;
    const frame = (now: number) => {
      if (cancelled) {
        return;
      }
      setPlaybackNow(now);
      rafId = window.requestAnimationFrame(frame);
    };

    rafId = window.requestAnimationFrame(frame);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [playbackTransport !== null]);

  const playbackT = useMemo(() => {
    if (!playbackTransport) {
      return null;
    }
    const anchor = transportAnchorRef.current;
    if (!anchor) {
      return null;
    }
    const stepDurationMs = 60000 / Math.max(30, Math.min(300, Math.round(anchor.bpm))) / 4;
    const elapsedSteps = Math.max(0, (playbackNow - anchor.timestampMs) / Math.max(1, stepDurationMs));
    const repeatLength = Math.max(1, controllerSequencer.stepCount);
    const transportPosition = anchor.cycle * anchor.stepCount + anchor.playhead + elapsedSteps;
    const normalized = ((transportPosition % repeatLength) + repeatLength) % repeatLength;
    return clampControllerCurveUiPosition(normalized / repeatLength);
  }, [controllerSequencer.stepCount, playbackNow, playbackTransport]);
  const playbackValue =
    playbackT === null ? null : sampleControllerCurveValue(controllerSequencer.keypoints, playbackT);

  const getSvgPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    return {
      x: Math.max(0, Math.min(width, x)),
      y: Math.max(0, Math.min(height, y))
    };
  }, []);

  const handleBackgroundPointerDown = useCallback(
    (event: ReactPointerEvent<SVGRectElement>) => {
      if (event.button !== 0) {
        return;
      }
      const point = getSvgPoint(event);
      if (!point) {
        return;
      }
      const position = clampControllerCurveUiPosition(point.x / width);
      const value = controllerCurveYToValue(point.y, height);
      if (position <= 0 || position >= 1) {
        return;
      }
      onAddPoint(position, value);
    },
    [getSvgPoint, onAddPoint]
  );

  const releaseDrag = useCallback((pointerId: number) => {
    if (dragRef.current?.pointerId !== pointerId) {
      return;
    }
    dragRef.current = null;
  }, []);

  const handlePointPointerDown = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>, keypointId: string) => {
      if (event.button !== 0) {
        return;
      }
      const keypoint = controllerSequencer.keypoints.find((point) => point.id === keypointId);
      if (!keypoint) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = {
        pointerId: event.pointerId,
        keypointId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPosition: keypoint.position,
        startValue: keypoint.value,
        dragging: false
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [controllerSequencer.keypoints]
  );

  const handlePointPointerMove = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>) => {
      const dragState = dragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }
      const dragDistance = Math.hypot(event.clientX - dragState.startClientX, event.clientY - dragState.startClientY);
      if (!dragState.dragging && dragDistance < 3) {
        return;
      }
      if (!dragState.dragging) {
        dragRef.current = {
          ...dragState,
          dragging: true
        };
      }
      event.preventDefault();
      const svg = svgRef.current;
      const rect = svg?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return;
      }
      const sortedKeypoints = controllerSequencer.keypoints;
      const keypointIndex = sortedKeypoints.findIndex((keypoint) => keypoint.id === dragState.keypointId);
      if (keypointIndex < 0) {
        return;
      }
      const currentKeypoint = sortedKeypoints[keypointIndex];
      const isStart = currentKeypoint.position <= 1e-6;
      const isEnd = currentKeypoint.position >= 1 - 1e-6;
      const deltaX = event.clientX - dragState.startClientX;
      const deltaY = event.clientY - dragState.startClientY;
      let nextPosition = clampControllerCurveUiPosition(dragState.startPosition + deltaX / rect.width);
      const nextValue = clampMidiControllerValue(dragState.startValue + (-deltaY / rect.height) * 127);

      if (isStart) {
        nextPosition = 0;
      } else if (isEnd) {
        nextPosition = 1;
      } else {
        const epsilon = 0.001;
        const previousNeighbor = sortedKeypoints[keypointIndex - 1];
        const nextNeighbor = sortedKeypoints[keypointIndex + 1];
        const minPosition = Math.min(1 - epsilon, (previousNeighbor?.position ?? 0) + epsilon);
        const maxPosition = Math.max(epsilon, (nextNeighbor?.position ?? 1) - epsilon);
        nextPosition = Math.max(minPosition, Math.min(maxPosition, nextPosition));
      }

      onPointChange(dragState.keypointId, nextPosition, nextValue);
    },
    [controllerSequencer.keypoints, onPointChange]
  );

  const handlePointPointerUp = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>) => {
      releaseDrag(event.pointerId);
    },
    [releaseDrag]
  );

  const handlePointPointerCancel = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>) => {
      releaseDrag(event.pointerId);
    },
    [releaseDrag]
  );

  const handlePointDoubleClick = useCallback(
    (event: ReactMouseEvent<SVGCircleElement>, keypointId: string) => {
      event.stopPropagation();
      onPointRemove(keypointId);
    },
    [onPointRemove]
  );

  const visualPoints = useMemo(
    () =>
      controllerSequencer.keypoints.map((point) => ({
        ...point,
        removable: point.position > 1e-6 && point.position < 1 - 1e-6
      })) as Array<ControllerSequencerKeypoint & { removable: boolean }>,
    [controllerSequencer.keypoints]
  );

  return (
    <div className="rounded-xl border border-teal-700/50 bg-slate-950/70 p-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ui.curveEditorHint}
        className="h-40 w-full cursor-crosshair overflow-visible rounded-lg border border-slate-700 bg-slate-950"
      >
        <defs>
          <linearGradient id={`controller-curve-${controllerSequencer.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#67e8f9" />
            <stop offset="55%" stopColor="#5eead4" />
            <stop offset="100%" stopColor="#2dd4bf" />
          </linearGradient>
        </defs>

        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          onPointerDown={handleBackgroundPointerDown}
        />

        {Array.from({ length: 8 }, (_, index) => {
          const y = (index / 7) * height;
          return (
            <line
              key={`grid-y-${index}`}
              x1={0}
              y1={y}
              x2={width}
              y2={y}
              stroke={index === 0 || index === 7 ? "rgba(100,116,139,0.45)" : "rgba(51,65,85,0.35)"}
              strokeWidth={1}
            />
          );
        })}
        {Array.from({ length: 9 }, (_, index) => {
          const x = (index / 8) * width;
          return (
            <line
              key={`grid-x-${index}`}
              x1={x}
              y1={0}
              x2={x}
              y2={height}
              stroke={index === 0 || index === 8 ? "rgba(100,116,139,0.45)" : "rgba(51,65,85,0.3)"}
              strokeWidth={1}
            />
          );
        })}

        <path
          d={path}
          fill="none"
          stroke={`url(#controller-curve-${controllerSequencer.id})`}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {playbackT !== null && playbackValue !== null ? (
          <>
            <line
              x1={playbackT * width}
              y1={0}
              x2={playbackT * width}
              y2={height}
              stroke="rgba(103,232,249,0.45)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <circle
              cx={playbackT * width}
              cy={controllerCurveValueToY(playbackValue, height)}
              r={5}
              fill="#67e8f9"
              stroke="rgba(15,23,42,0.9)"
              strokeWidth={2}
            />
          </>
        ) : null}

        {visualPoints.map((point) => {
          const cx = point.position * width;
          const cy = controllerCurveValueToY(point.value, height);
          return (
            <circle
              key={`${controllerSequencer.id}-${point.id}`}
              cx={cx}
              cy={cy}
              r={point.removable ? 5 : 4}
              fill={point.removable ? "#ccfbf1" : "#94a3b8"}
              stroke={point.removable ? "#14b8a6" : "#475569"}
              strokeWidth={2}
              className={point.removable ? "cursor-move" : "cursor-ns-resize"}
              onPointerDown={(event) => handlePointPointerDown(event, point.id)}
              onPointerMove={handlePointPointerMove}
              onPointerUp={handlePointPointerUp}
              onPointerCancel={handlePointPointerCancel}
              onLostPointerCapture={handlePointPointerCancel}
              onDoubleClick={
                point.removable ? (event) => handlePointDoubleClick(event, point.id) : undefined
              }
              aria-label={point.removable ? ui.removeCurvePoint : undefined}
            />
          );
        })}
      </svg>
      <div className="mt-2 text-[10px] text-slate-500">{ui.curveEditorHint}</div>
    </div>
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
  onClonePerformance: () => void;
  onDeletePerformance: () => void;
  onLoadPerformance: (performanceId: string) => void;
  onExportConfig: () => void;
  onImportConfig: (file: File) => void;
  onStartInstruments: () => void;
  onStopInstruments: () => void;
  onBpmChange: (bpm: number) => void;
  onAddSequencerTrack: () => void;
  onAddControllerSequencer: () => void;
  onRemoveSequencerTrack: (trackId: string) => void;
  onSequencerTrackEnabledChange: (trackId: string, enabled: boolean) => void;
  onSequencerTrackChannelChange: (trackId: string, channel: number) => void;
  onSequencerTrackScaleChange: (trackId: string, scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
  onSequencerTrackModeChange: (trackId: string, mode: SequencerMode) => void;
  onSequencerTrackStepCountChange: (trackId: string, count: 16 | 32) => void;
  onSequencerTrackStepNoteChange: (trackId: string, index: number, note: number | null) => void;
  onSequencerTrackStepHoldChange: (trackId: string, index: number, hold: boolean) => void;
  onSequencerTrackStepVelocityChange: (trackId: string, index: number, velocity: number) => void;
  onSequencerTrackClearSteps: (trackId: string) => void;
  onSequencerPadPress: (trackId: string, padIndex: number) => void;
  onSequencerPadCopy: (trackId: string, sourcePadIndex: number, targetPadIndex: number) => void;
  onSequencerPadTransposeShort: (trackId: string, padIndex: number, direction: -1 | 1) => void;
  onSequencerPadTransposeLong: (trackId: string, padIndex: number, direction: -1 | 1) => void;
  onSequencerTrackPadLoopEnabledChange: (trackId: string, enabled: boolean) => void;
  onSequencerTrackPadLoopRepeatChange: (trackId: string, repeat: boolean) => void;
  onSequencerTrackPadLoopStepAdd: (trackId: string, padIndex: number) => void;
  onSequencerTrackPadLoopStepRemove: (trackId: string, sequenceIndex: number) => void;
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
  onRemoveControllerSequencer: (controllerSequencerId: string) => void;
  onControllerSequencerEnabledChange: (controllerSequencerId: string, enabled: boolean) => void;
  onControllerSequencerNumberChange: (controllerSequencerId: string, controllerNumber: number) => void;
  onControllerSequencerStepCountChange: (controllerSequencerId: string, stepCount: 8 | 16 | 32 | 64) => void;
  onControllerSequencerKeypointAdd: (controllerSequencerId: string, position: number, value: number) => void;
  onControllerSequencerKeypointChange: (
    controllerSequencerId: string,
    keypointId: string,
    position: number,
    value: number
  ) => void;
  onControllerSequencerKeypointValueChange: (
    controllerSequencerId: string,
    keypointId: string,
    value: number
  ) => void;
  onControllerSequencerKeypointRemove: (controllerSequencerId: string, keypointId: string) => void;
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

function previousNonRestNote(steps: SequencerStepState[], fromIndex: number): number | null {
  for (let index = fromIndex - 1; index >= 0; index -= 1) {
    const note = steps[index]?.note;
    if (typeof note === "number") {
      return note;
    }
  }
  return null;
}

function parseSequencerPadDragPayload(event: ReactDragEvent): SequencerPadDragPayload | null {
  const raw =
    event.dataTransfer.getData(SEQUENCER_PAD_DRAG_MIME) || event.dataTransfer.getData("text/plain");
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SequencerPadDragPayload>;
    if (typeof parsed.trackId !== "string" || typeof parsed.padIndex !== "number" || !Number.isFinite(parsed.padIndex)) {
      return null;
    }
    return {
      trackId: parsed.trackId,
      padIndex: Math.round(parsed.padIndex)
    };
  } catch {
    return null;
  }
}

function padSequencePadIndexFromKey(event: ReactKeyboardEvent): number | null {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }
  if (!/^[1-8]$/.test(event.key)) {
    return null;
  }
  return Number(event.key) - 1;
}

interface RunningSequencerTheory {
  scaleRoot: SequencerScaleRoot;
  scaleType: SequencerScaleType;
  mode: SequencerMode;
}

function scaleLabelFor(
  scaleRoot: SequencerScaleRoot,
  scaleType: SequencerScaleType,
  scaleTypeLabels: Record<SequencerScaleType, string>
): string {
  return scaleTypeLabels[scaleType].length > 0 ? `${scaleRoot} ${scaleTypeLabels[scaleType]}` : scaleRoot;
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
  onClonePerformance,
  onDeletePerformance,
  onLoadPerformance,
  onExportConfig,
  onImportConfig,
  onStartInstruments,
  onStopInstruments,
  onBpmChange,
  onAddSequencerTrack,
  onAddControllerSequencer,
  onRemoveSequencerTrack,
  onSequencerTrackEnabledChange,
  onSequencerTrackChannelChange,
  onSequencerTrackScaleChange,
  onSequencerTrackModeChange,
  onSequencerTrackStepCountChange,
  onSequencerTrackStepNoteChange,
  onSequencerTrackStepHoldChange,
  onSequencerTrackStepVelocityChange,
  onSequencerTrackClearSteps,
  onSequencerPadPress,
  onSequencerPadCopy,
  onSequencerPadTransposeShort,
  onSequencerPadTransposeLong,
  onSequencerTrackPadLoopEnabledChange,
  onSequencerTrackPadLoopRepeatChange,
  onSequencerTrackPadLoopStepAdd,
  onSequencerTrackPadLoopStepRemove,
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
  onRemoveControllerSequencer,
  onControllerSequencerEnabledChange,
  onControllerSequencerNumberChange,
  onControllerSequencerStepCountChange,
  onControllerSequencerKeypointAdd,
  onControllerSequencerKeypointChange,
  onControllerSequencerKeypointValueChange,
  onControllerSequencerKeypointRemove,
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
  const runningSequencerTheories = useMemo<RunningSequencerTheory[]>(
    () => {
      const enabledTracks = sequencer.tracks.filter((track) => track.enabled);
      const sourceTracks = enabledTracks.length > 0 ? enabledTracks : sequencer.tracks;
      return sourceTracks.map((track) => ({
        scaleRoot: track.scaleRoot,
        scaleType: track.scaleType,
        mode: track.mode
      }));
    },
    [sequencer.tracks]
  );
  const runningSequencerSummary = useMemo(() => {
    if (runningSequencerTheories.length === 0) {
      return null;
    }

    const first = runningSequencerTheories[0];
    const sharedScale =
      runningSequencerTheories.every(
        (theory) => theory.scaleRoot === first.scaleRoot && theory.scaleType === first.scaleType
      )
        ? { scaleRoot: first.scaleRoot, scaleType: first.scaleType }
        : null;
    const sharedMode = runningSequencerTheories.every((theory) => theory.mode === first.mode)
      ? first.mode
      : null;
    const highlightTheories: PianoRollHighlightTheory[] =
      sharedScale && sharedMode
        ? [{ scaleRoot: sharedScale.scaleRoot, mode: sharedMode }]
        : runningSequencerTheories.map((theory) => ({
            scaleRoot: theory.scaleRoot,
            mode: theory.mode
          }));

    return {
      sharedScale,
      sharedMode,
      highlightTheories
    };
  }, [runningSequencerTheories]);
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
  const [pendingStartAllPianoRolls, setPendingStartAllPianoRolls] = useState(false);
  const padTransposePressRef = useRef<Record<string, { timerId: number; longPressTriggered: boolean }>>({});
  const triggerConfigLoad = useCallback(() => {
    configFileInputRef.current?.click();
  }, []);

  useEffect(() => {
    return () => {
      for (const key of Object.keys(padTransposePressRef.current)) {
        window.clearTimeout(padTransposePressRef.current[key].timerId);
      }
      padTransposePressRef.current = {};
    };
  }, []);

  const enableAllNonPianoRollDevices = useCallback(() => {
    for (const track of sequencer.tracks) {
      if (!track.enabled) {
        onSequencerTrackEnabledChange(track.id, true);
      }
    }
    for (const controllerSequencer of sequencer.controllerSequencers) {
      if (!controllerSequencer.enabled) {
        onControllerSequencerEnabledChange(controllerSequencer.id, true);
      }
    }
    for (const controller of sequencer.midiControllers) {
      if (!controller.enabled) {
        onMidiControllerEnabledChange(controller.id, true);
      }
    }
  }, [
    onControllerSequencerEnabledChange,
    onMidiControllerEnabledChange,
    onSequencerTrackEnabledChange,
    sequencer.controllerSequencers,
    sequencer.midiControllers,
    sequencer.tracks
  ]);

  const enableAllPianoRolls = useCallback(() => {
    for (const roll of sequencer.pianoRolls) {
      if (!roll.enabled) {
        onPianoRollEnabledChange(roll.id, true);
      }
    }
  }, [onPianoRollEnabledChange, sequencer.pianoRolls]);

  const disableAllDevices = useCallback(() => {
    for (const track of sequencer.tracks) {
      if (track.enabled || track.queuedEnabled === true) {
        onSequencerTrackEnabledChange(track.id, false);
      }
    }
    for (const controllerSequencer of sequencer.controllerSequencers) {
      if (controllerSequencer.enabled) {
        onControllerSequencerEnabledChange(controllerSequencer.id, false);
      }
    }
    for (const roll of sequencer.pianoRolls) {
      if (roll.enabled) {
        onPianoRollEnabledChange(roll.id, false);
      }
    }
    for (const controller of sequencer.midiControllers) {
      if (controller.enabled) {
        onMidiControllerEnabledChange(controller.id, false);
      }
    }
  }, [
    onControllerSequencerEnabledChange,
    onMidiControllerEnabledChange,
    onPianoRollEnabledChange,
    onSequencerTrackEnabledChange,
    sequencer.controllerSequencers,
    sequencer.midiControllers,
    sequencer.pianoRolls,
    sequencer.tracks
  ]);

  const handleStartAll = useCallback(() => {
    enableAllNonPianoRollDevices();

    if (instrumentsRunning) {
      enableAllPianoRolls();
      setPendingStartAllPianoRolls(false);
      return;
    }

    setPendingStartAllPianoRolls(sequencer.pianoRolls.some((roll) => !roll.enabled));
    onStartInstruments();
  }, [enableAllNonPianoRollDevices, enableAllPianoRolls, instrumentsRunning, onStartInstruments, sequencer.pianoRolls]);

  const handleStopAll = useCallback(() => {
    setPendingStartAllPianoRolls(false);
    disableAllDevices();
    if (instrumentsRunning) {
      onStopInstruments();
    }
  }, [disableAllDevices, instrumentsRunning, onStopInstruments]);

  useEffect(() => {
    if (!pendingStartAllPianoRolls || !instrumentsRunning) {
      return;
    }
    enableAllPianoRolls();
    setPendingStartAllPianoRolls(false);
  }, [enableAllPianoRolls, instrumentsRunning, pendingStartAllPianoRolls]);

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

  const padTransposePressKey = useCallback((trackId: string, padIndex: number, direction: -1 | 1) => {
    return `${trackId}:${padIndex}:${direction}`;
  }, []);

  const cancelPadTransposePress = useCallback((trackId: string, padIndex: number, direction: -1 | 1) => {
    const key = padTransposePressKey(trackId, padIndex, direction);
    const activePress = padTransposePressRef.current[key];
    if (!activePress) {
      return;
    }
    window.clearTimeout(activePress.timerId);
    delete padTransposePressRef.current[key];
  }, [padTransposePressKey]);

  const handlePadTransposePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, trackId: string, padIndex: number, direction: -1 | 1) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      event.preventDefault();

      const key = padTransposePressKey(trackId, padIndex, direction);
      const existing = padTransposePressRef.current[key];
      if (existing) {
        window.clearTimeout(existing.timerId);
      }

      if (event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      const timerId = window.setTimeout(() => {
        const activePress = padTransposePressRef.current[key];
        if (!activePress || activePress.longPressTriggered) {
          return;
        }
        activePress.longPressTriggered = true;
        onSequencerPadTransposeLong(trackId, padIndex, direction);
      }, PAD_TRANSPOSE_LONG_PRESS_MS);

      padTransposePressRef.current[key] = {
        timerId,
        longPressTriggered: false
      };
    },
    [onSequencerPadTransposeLong, padTransposePressKey]
  );

  const handlePadTransposePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, trackId: string, padIndex: number, direction: -1 | 1) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      event.preventDefault();

      const key = padTransposePressKey(trackId, padIndex, direction);
      const activePress = padTransposePressRef.current[key];
      if (!activePress) {
        return;
      }
      window.clearTimeout(activePress.timerId);
      delete padTransposePressRef.current[key];

      if (!activePress.longPressTriggered) {
        onSequencerPadTransposeShort(trackId, padIndex, direction);
      }
    },
    [onSequencerPadTransposeShort, padTransposePressKey]
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
        accept="application/json,.json,.orch.json,.zip,.orch.zip,application/zip,application/x-zip-compressed"
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
            onClick={onClonePerformance}
            className="rounded-md border border-slate-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
          >
            {ui.clonePerformance}
          </button>
          <button
            type="button"
            onClick={onDeletePerformance}
            disabled={!currentPerformanceId}
            className="rounded-md border border-rose-500/60 bg-rose-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ui.deletePerformance}
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
                className="grid grid-cols-[minmax(0,_1fr)_88px_auto] items-end gap-2 rounded-lg border border-slate-600/80 bg-slate-800/75 px-2 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
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
            <button type="button" onClick={handleStartAll} className={transportStartButtonClass}>
              {ui.startAll}
            </button>
            <button type="button" onClick={handleStopAll} className={transportStopButtonClass}>
              {ui.stopAll}
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
          <button
            type="button"
            onClick={onAddControllerSequencer}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25"
          >
            {ui.addControllerSequencer}
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
            const pitchClassOptions = buildSequencerPitchClassOptions(noteOptions);
            const inScalePitchClassOptions = pitchClassOptions.filter((option) => option.inScale);
            const outOfScalePitchClassOptions = pitchClassOptions.filter((option) => !option.inScale);
            const scaleLabel =
              scaleTypeLabels[track.scaleType].length > 0
                ? `${track.scaleRoot} ${scaleTypeLabels[track.scaleType]}`
                : track.scaleRoot;
            const modeLabel = modeLabels[track.mode];
            const scaleValue = `${track.scaleRoot}:${track.scaleType}`;
            const stepIndices = Array.from({ length: track.stepCount }, (_, index) => index);

            return (
              <article key={track.id} className="relative rounded-xl border border-slate-700 bg-slate-900/65 p-2.5 pr-10">
                {onHelpRequest ? (
                  <HelpIconButton
                    guiLanguage={guiLanguage}
                    onClick={() => onHelpRequest("sequencer_track_editor")}
                    className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-500 bg-slate-950/90 text-xs font-bold text-slate-100 transition hover:border-accent hover:text-accent"
                  />
                ) : null}
                <div className="mb-2 flex flex-wrap items-center gap-2 pr-8">
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
                  <button
                    type="button"
                    onClick={() => onSequencerTrackClearSteps(track.id)}
                    className="rounded-md border border-slate-500/70 bg-slate-800/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400 hover:bg-slate-700"
                  >
                    {ui.clearSteps}
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

                  <div className="flex min-w-[300px] flex-1 flex-col gap-1">
                    <span className={controlLabelClass}>{ui.padLoopSequence}</span>
                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-950 p-1.5">
                      <button
                        type="button"
                        onClick={() => onSequencerTrackPadLoopEnabledChange(track.id, !track.padLoopEnabled)}
                        className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                          track.padLoopEnabled
                            ? "border-accent/70 bg-accent/20 text-accent"
                            : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                        }`}
                        aria-pressed={track.padLoopEnabled}
                      >
                        {ui.padLooper}: {track.padLoopEnabled ? ui.on : ui.off}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSequencerTrackPadLoopRepeatChange(track.id, !track.padLoopRepeat)}
                        className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                          track.padLoopRepeat
                            ? "border-emerald-400/55 bg-emerald-500/10 text-emerald-300"
                            : "border-amber-400/55 bg-amber-500/10 text-amber-300"
                        }`}
                        aria-pressed={track.padLoopRepeat}
                      >
                        {ui.repeat}: {track.padLoopRepeat ? ui.on : ui.off}
                      </button>

                      <div
                        tabIndex={0}
                        role="list"
                        aria-label={ui.padLoopSequence}
                        onKeyDown={(event) => {
                          const padIndex = padSequencePadIndexFromKey(event);
                          if (padIndex === null) {
                            return;
                          }
                          event.preventDefault();
                          onSequencerTrackPadLoopStepAdd(track.id, padIndex);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "copy";
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const payload = parseSequencerPadDragPayload(event);
                          if (!payload || payload.trackId !== track.id) {
                            return;
                          }
                          onSequencerTrackPadLoopStepAdd(track.id, payload.padIndex);
                        }}
                        className="min-h-[34px] min-w-[180px] flex-1 rounded-md border border-dashed border-slate-700 bg-slate-900/75 px-2 py-1 outline-none ring-accent/40 transition focus:ring"
                      >
                        {track.padLoopSequence.length === 0 ? (
                          <div className="flex min-h-[24px] items-center text-[10px] text-slate-500">
                            {ui.padLoopSequenceEmpty}
                          </div>
                        ) : (
                          <div className="flex min-h-[24px] flex-wrap items-center gap-1">
                            {track.padLoopSequence.map((padIndex, sequenceIndex) => {
                              const isCurrentLoopStep =
                                track.padLoopEnabled &&
                                sequencer.isPlaying &&
                                track.enabled &&
                                track.padLoopPosition === sequenceIndex;
                              return (
                                <span
                                  key={`${track.id}-pad-loop-${sequenceIndex}-${padIndex}`}
                                  role="listitem"
                                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition ${
                                    isCurrentLoopStep
                                      ? "border-accent bg-accent/25 text-accent shadow-[0_0_0_1px_rgba(14,165,233,0.45)]"
                                      : "border-slate-700 bg-slate-950 text-slate-100"
                                  }`}
                                >
                                  <span className="font-mono">{padIndex + 1}</span>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onSequencerTrackPadLoopStepRemove(track.id, sequenceIndex);
                                    }}
                                    className="rounded px-1 text-[10px] leading-none text-slate-400 transition hover:bg-slate-800 hover:text-rose-300"
                                    aria-label={ui.removePadLoopStep(padIndex + 1)}
                                    title={ui.remove}
                                  >
                                    x
                                  </button>
                                </span>
                              );
                            })}
                            <span className="text-[10px] text-slate-500">{ui.padLoopSequenceHint}</span>
                          </div>
                        )}
                      </div>
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
                      const padAccentClass = isActivePad
                        ? "border-accent/70 bg-accent/10 text-accent hover:bg-accent/15"
                        : isQueuedPad
                          ? "border-amber-400/60 bg-amber-500/5 text-amber-300 hover:bg-amber-500/10"
                          : "border-slate-700 bg-slate-950/85 text-slate-300 hover:border-slate-500 hover:bg-slate-900";
                      return (
                        <div key={`${track.id}-pad-${padIndex}`} className="relative">
                          <button
                            type="button"
                            draggable
                            onClick={() => onSequencerPadPress(track.id, padIndex)}
                            onDragStart={(event) => {
                              const payload = JSON.stringify({ trackId: track.id, padIndex });
                              event.dataTransfer.effectAllowed = "copy";
                              event.dataTransfer.setData(SEQUENCER_PAD_DRAG_MIME, payload);
                              event.dataTransfer.setData("text/plain", payload);
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "copy";
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const payload = parseSequencerPadDragPayload(event);
                              if (!payload || payload.trackId !== track.id || payload.padIndex === padIndex) {
                                return;
                              }
                              onSequencerPadCopy(track.id, payload.padIndex, padIndex);
                            }}
                            className={`w-full rounded-md border px-5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                              isActivePad
                                ? "border-accent bg-accent/25 text-accent"
                                : isQueuedPad
                                  ? "border-amber-400/70 bg-amber-500/10 text-amber-300"
                                  : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                            }`}
                          >
                            P{padIndex + 1}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onPointerDown={(event) => handlePadTransposePointerDown(event, track.id, padIndex, -1)}
                            onPointerUp={(event) => handlePadTransposePointerUp(event, track.id, padIndex, -1)}
                            onPointerCancel={() => cancelPadTransposePress(track.id, padIndex, -1)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") {
                                return;
                              }
                              event.preventDefault();
                              event.stopPropagation();
                              onSequencerPadTransposeShort(track.id, padIndex, -1);
                            }}
                            className={`absolute inset-y-0 left-0 z-10 flex w-4 items-center justify-center rounded-l-md border text-[10px] font-bold transition ${padAccentClass}`}
                            aria-label={`Transpose pattern pad ${padIndex + 1} down (click: in-scale, hold: key-step)`}
                            title="Short: transpose notes in scale | Long: move key down by degree"
                          >
                            -
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onPointerDown={(event) => handlePadTransposePointerDown(event, track.id, padIndex, 1)}
                            onPointerUp={(event) => handlePadTransposePointerUp(event, track.id, padIndex, 1)}
                            onPointerCancel={() => cancelPadTransposePress(track.id, padIndex, 1)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") {
                                return;
                              }
                              event.preventDefault();
                              event.stopPropagation();
                              onSequencerPadTransposeShort(track.id, padIndex, 1);
                            }}
                            className={`absolute inset-y-0 right-0 z-10 flex w-4 items-center justify-center rounded-r-md border text-[10px] font-bold transition ${padAccentClass}`}
                            aria-label={`Transpose pattern pad ${padIndex + 1} up (click: in-scale, hold: key-step)`}
                            title="Short: transpose notes in scale | Long: move key up by degree"
                          >
                            +
                          </button>
                        </div>
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
                      const stepState = track.steps[step];
                      const noteValue = stepState?.note ?? null;
                      const holdActive = stepState?.hold === true;
                      const stepVelocity = stepState?.velocity ?? 127;
                      const localPlayhead = sequencer.playhead % track.stepCount;
                      const isActive = track.enabled && sequencer.isPlaying && localPlayhead === step;
                      const selectedNote = noteValue === null ? null : noteOptionsByNote.get(noteValue) ?? null;
                      const isInScale = selectedNote?.inScale ?? false;
                      const degree = selectedNote?.degree ?? null;
                      const notePitchClass = noteValue === null ? null : midiNotePitchClass(noteValue);
                      const noteOctave = noteValue === null ? null : midiNoteOctave(noteValue);
                      const stepKey = `${track.id}:${step}`;
                      const selectValue =
                        stepSelectPreview[stepKey] ?? (notePitchClass === null ? "" : String(notePitchClass));
                      const selectedLabel =
                        noteValue === null
                          ? ui.rest
                          : isInScale && degree !== null
                            ? `${pianoKeyNoteName(selectedNote?.label, noteValue)} (${degree})`
                            : pianoKeyNoteName(selectedNote?.label, noteValue);

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
                          <div className="relative pr-12 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
                            <button
                              type="button"
                              onClick={() => onSequencerTrackStepHoldChange(track.id, step, !holdActive)}
                              className="absolute right-0 top-0 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-slate-300 transition hover:bg-slate-800/80"
                              title={ui.hold}
                              aria-label={ui.hold}
                            >
                              <span>{ui.hold}</span>
                              <span
                                className={`h-2.5 w-2.5 rounded-full border ${
                                  holdActive
                                    ? "border-emerald-200 bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.95)]"
                                    : "border-slate-500 bg-slate-600"
                                }`}
                              />
                            </button>
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
                                const fallbackValue = String(midiNotePitchClass(fallbackNote));
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
                                const fallbackValue = String(midiNotePitchClass(fallbackNote));
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
                                if (raw.length === 0) {
                                  onSequencerTrackStepNoteChange(track.id, step, null);
                                  return;
                                }
                                const nextPitchClass = Number(raw);
                                const fallbackNote = previousNonRestNote(track.steps, step);
                                const nextOctave =
                                  noteOctave ??
                                  (fallbackNote === null ? 4 : midiNoteOctave(fallbackNote));
                                onSequencerTrackStepNoteChange(
                                  track.id,
                                  step,
                                  sequencerMidiNoteFromPitchClassOctave(nextPitchClass, nextOctave)
                                );
                              }}
                              className="h-8 w-full appearance-none rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-center font-mono text-[11px] text-transparent outline-none ring-accent/40 transition focus:ring"
                            >
                              <optgroup label={ui.rest}>
                                <option value="" style={{ color: "#f8fafc" }}>
                                  {ui.rest}
                                </option>
                              </optgroup>
                              <optgroup label={ui.inScaleOptgroup(scaleLabel, modeLabel)}>
                                {inScalePitchClassOptions.map((option) => (
                                  <option
                                    key={`${track.id}-in-pc-${option.pitchClass}`}
                                    value={option.pitchClass}
                                    style={{ color: "#f8fafc" }}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label={ui.outOfScaleOptgroup}>
                                {outOfScalePitchClassOptions.map((option) => (
                                  <option
                                    key={`${track.id}-out-pc-${option.pitchClass}`}
                                    value={option.pitchClass}
                                    style={{ color: "#f8fafc" }}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </optgroup>
                            </select>
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[11px] text-slate-100">
                              {selectedLabel}
                            </div>
                          </div>

                          <label className="mt-1 flex items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1">
                            <span className="text-[9px] uppercase tracking-[0.16em] text-slate-400">OCT</span>
                            <input
                              type="number"
                              min={0}
                              max={7}
                              step={1}
                              disabled={noteValue === null}
                              value={noteOctave ?? 4}
                              onChange={(event) => {
                                if (noteValue === null) {
                                  return;
                                }
                                const raw = event.target.value.trim();
                                if (raw.length === 0) {
                                  return;
                                }
                                onSequencerTrackStepNoteChange(
                                  track.id,
                                  step,
                                  sequencerMidiNoteFromPitchClassOctave(notePitchClass ?? 0, Number(raw))
                                );
                              }}
                              className="w-14 rounded border border-slate-600 bg-slate-950 px-1.5 py-0.5 text-center font-mono text-[11px] text-slate-100 outline-none ring-accent/40 transition focus:ring disabled:cursor-not-allowed disabled:opacity-50"
                              aria-label={`${ui.octave} ${step + 1}`}
                            />
                          </label>

                          <label className="mt-1 flex items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1">
                            <span className="text-[9px] uppercase tracking-[0.16em] text-slate-400">VEL</span>
                            <input
                              type="number"
                              min={0}
                              max={127}
                              step={1}
                              value={stepVelocity}
                              onChange={(event) => {
                                const raw = event.target.value.trim();
                                if (raw.length === 0) {
                                  return;
                                }
                                onSequencerTrackStepVelocityChange(track.id, step, Number(raw));
                              }}
                              className="w-14 rounded border border-slate-600 bg-slate-950 px-1.5 py-0.5 text-center font-mono text-[11px] text-slate-100 outline-none ring-accent/40 transition focus:ring"
                              aria-label={`VEL ${step + 1}`}
                            />
                          </label>

                          <div
                            className={`mt-1 text-center text-[10px] ${
                              noteValue === null
                                ? holdActive
                                  ? "text-emerald-300"
                                  : "text-slate-500"
                                : isInScale
                                  ? "text-emerald-300"
                                  : "text-amber-300"
                            }`}
                          >
                            {noteValue === null
                              ? holdActive
                                ? `${ui.rest.toLowerCase()} + ${ui.hold.toLowerCase()}`
                                : ui.rest.toLowerCase()
                              : isInScale
                                ? ui.inScaleDegree(degree)
                                : ui.outOfScale}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </article>
            );
          })}

          {sequencer.controllerSequencers.length > 0 ? (
            <div className="rounded-xl border border-teal-800/45 bg-slate-900/45 p-2.5">
              <div className="mb-2 text-xs uppercase tracking-[0.2em] text-teal-200">Controller Sequencers</div>
              <div className="space-y-3">
                {sequencer.controllerSequencers.map((controllerSequencer, controllerSequencerIndex) => (
                  <article
                    key={controllerSequencer.id}
                    className="relative rounded-xl border border-slate-700 bg-slate-900/70 p-2.5 pr-10"
                  >
                    {onHelpRequest ? (
                      <HelpIconButton
                        guiLanguage={guiLanguage}
                        onClick={() => onHelpRequest("sequencer_controller_sequencer")}
                        className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-500 bg-slate-950/90 text-xs font-bold text-slate-100 transition hover:border-accent hover:text-accent"
                      />
                    ) : null}
                    <div className="mb-2 flex flex-wrap items-center gap-2 pr-8">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">
                        {controllerSequencer.name || ui.controllerSequencerWithIndex(controllerSequencerIndex + 1)}
                      </div>
                      <span className={transportStateClass}>
                        {controllerSequencer.enabled ? ui.running : ui.stopped}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onControllerSequencerEnabledChange(controllerSequencer.id, !controllerSequencer.enabled)
                        }
                        disabled={!instrumentsRunning && !controllerSequencer.enabled}
                        className={
                          controllerSequencer.enabled ? transportStopButtonClass : transportStartButtonClass
                        }
                      >
                        {controllerSequencer.enabled ? ui.stop : ui.start}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveControllerSequencer(controllerSequencer.id)}
                        className="rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25"
                      >
                        {ui.remove}
                      </button>
                    </div>

                    <div className="mb-2 flex flex-wrap items-end gap-2">
                      <label className="flex min-w-[120px] flex-col gap-1">
                        <span className={controlLabelClass}>{ui.controllerNumber}</span>
                        <input
                          type="number"
                          min={0}
                          max={127}
                          value={controllerSequencer.controllerNumber}
                          onChange={(event) =>
                            onControllerSequencerNumberChange(controllerSequencer.id, Number(event.target.value))
                          }
                          className={`${controlFieldClass} w-24`}
                        />
                      </label>

                      <div className="flex flex-col gap-1">
                        <span className={controlLabelClass}>{ui.curveRate}</span>
                        <div className="inline-flex rounded-lg border border-slate-600 bg-slate-950 p-1">
                          {CONTROLLER_SEQUENCER_STEP_OPTIONS.map((option) => (
                            <button
                              key={`${controllerSequencer.id}-rate-${option}`}
                              type="button"
                              onClick={() =>
                                onControllerSequencerStepCountChange(controllerSequencer.id, option)
                              }
                              className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                                controllerSequencer.stepCount === option
                                  ? "bg-teal-400/20 text-teal-200"
                                  : "text-slate-300 hover:bg-slate-800"
                              }`}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200">
                        CC {controllerSequencer.controllerNumber}
                      </div>
                    </div>

                    <ControllerSequencerCurveEditor
                      ui={ui}
                      controllerSequencer={controllerSequencer}
                      playbackTransport={
                        sequencer.isPlaying && controllerSequencer.enabled
                          ? {
                              playhead: sequencer.playhead,
                              cycle: sequencer.cycle,
                              stepCount: sequencer.stepCount,
                              bpm: sequencer.bpm
                            }
                          : null
                      }
                      onAddPoint={(position, value) =>
                        onControllerSequencerKeypointAdd(controllerSequencer.id, position, value)
                      }
                      onPointChange={(keypointId, position, value) =>
                        onControllerSequencerKeypointChange(controllerSequencer.id, keypointId, position, value)
                      }
                      onPointRemove={(keypointId) =>
                        onControllerSequencerKeypointRemove(controllerSequencer.id, keypointId)
                      }
                    />
                  </article>
                ))}
              </div>
            </div>
          ) : null}
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
            const followSummary = instrumentsRunning && roll.enabled ? runningSequencerSummary : null;
            const followsMixedScale = followSummary !== null && followSummary.sharedScale === null;
            const followsMixedMode = followSummary !== null && followSummary.sharedMode === null;
            const effectiveScaleRoot = followSummary?.sharedScale?.scaleRoot ?? roll.scaleRoot;
            const effectiveScaleType = followSummary?.sharedScale?.scaleType ?? roll.scaleType;
            const effectiveScaleValue = followsMixedScale
              ? MIXED_SELECT_VALUE
              : `${effectiveScaleRoot}:${effectiveScaleType}`;
            const effectiveScaleLabel = followsMixedScale
              ? ui.mixed
              : scaleLabelFor(effectiveScaleRoot, effectiveScaleType, scaleTypeLabels);
            const effectiveMode = followSummary?.sharedMode ?? roll.mode;
            const effectiveModeValue = followsMixedMode ? MIXED_SELECT_VALUE : effectiveMode;
            const effectiveModeLabel = followsMixedMode ? ui.mixed : modeLabels[effectiveMode];
            const keyboardHighlightTheories =
              followSummary?.highlightTheories ?? [{ scaleRoot: roll.scaleRoot, mode: roll.mode }];
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
                      value={effectiveScaleValue}
                      disabled={followSummary !== null}
                      onChange={(event) => {
                        const selected = parseSequencerScaleValue(event.target.value);
                        if (selected) {
                          onPianoRollScaleChange(roll.id, selected.root, selected.type);
                        }
                      }}
                      className={controlFieldClass}
                    >
                      {followsMixedScale ? (
                        <option value={MIXED_SELECT_VALUE} disabled>
                          {ui.mixed}
                        </option>
                      ) : null}
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
                      value={effectiveModeValue}
                      disabled={followSummary !== null}
                      onChange={(event) => onPianoRollModeChange(roll.id, event.target.value as SequencerMode)}
                      className={controlFieldClass}
                    >
                      {followsMixedMode ? (
                        <option value={MIXED_SELECT_VALUE} disabled>
                          {ui.mixed}
                        </option>
                      ) : null}
                      {modeOptions.map((option) => (
                        <option key={`${roll.id}-mode-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mb-2 text-[11px] text-slate-500">
                  {ui.inScaleHighlightInfo(effectiveScaleLabel, effectiveModeLabel)}
                </div>

                <div className="relative left-1/2 w-screen -translate-x-1/2 px-4 sm:px-6 lg:px-8">
                  <PianoRollKeyboard
                    ui={ui}
                    roll={roll}
                    instrumentsRunning={instrumentsRunning}
                    highlightTheories={keyboardHighlightTheories}
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
            disabled={sequencer.midiControllers.length >= 6}
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
