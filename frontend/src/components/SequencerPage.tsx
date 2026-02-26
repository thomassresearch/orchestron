import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";

import {
  canCreatePadLoopGroupFromSelection,
  canInsertItemIntoPadLoopContainer,
  compilePadLoopPattern,
  getPadLoopContainerSequence,
  groupPadLoopItemsInContainer,
  insertPadLoopItem,
  itemColorKind,
  itemDisplayLabel,
  movePadLoopItemWithinContainer,
  padLoopContainerLevel,
  removePadLoopItemsFromContainer,
  ungroupPadLoopItemsInContainer,
  type PadLoopContainerRef
} from "../lib/padLoopPattern";
import {
  buildControllerCurvePath,
  buildSequencerChordOptions,
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
  PadLoopPatternItem,
  PadLoopPatternState,
  ControllerSequencerState,
  DrummerSequencerStepCount,
  DrummerSequencerTrackState,
  SequencerInstrumentBinding,
  SequencerChord,
  SequencerMode,
  SequencerScaleRoot,
  SequencerScaleType,
  SequencerState,
  SequencerStepState,
  SequencerTrackState
} from "../types";

const PIANO_ROLL_START_NOTE = 12; // C0
const PIANO_ROLL_NOTE_COUNT = 96; // C0..B7
const PIANO_WHITE_KEY_WIDTH = 36;
const PIANO_WHITE_KEY_HEIGHT = 132;
const PIANO_BLACK_KEY_WIDTH = 22;
const PIANO_BLACK_KEY_HEIGHT = 84;
const PIANO_SCROLL_STEP_PX = PIANO_WHITE_KEY_WIDTH * 8;
const MIXED_SELECT_VALUE = "__mixed__";
const SEQUENCER_PAD_DRAG_MIME = "application/x-visualcsound-sequencer-pad";
const SEQUENCER_TRACK_DRAG_MIME = "application/x-visualcsound-sequencer-track";
const SEQUENCER_STEP_DRAG_MIME = "application/x-visualcsound-sequencer-step";
const PAD_LOOP_ITEM_DRAG_MIME = "application/x-visualcsound-pad-loop-item";
const PAD_LOOP_REF_DRAG_MIME = "application/x-visualcsound-pad-loop-ref";
const PAD_TRANSPOSE_LONG_PRESS_MS = 350;

type SequencerPadDragPayload = {
  trackId: string;
  padIndex: number;
};

type SequencerTrackDragPayload = {
  trackId: string;
};

type SequencerStepDragPayload = {
  trackId: string;
  stepIndex: number;
};

type PadLoopItemDragPayload = {
  sourceContainer: PadLoopContainerRef;
  sourceIndex: number;
};

type PadLoopReferenceDragPayload = {
  item: PadLoopPatternItem;
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
  newPerformance: string;
  addInstrument: string;
  savePerformance: string;
  clonePerformance: string;
  deletePerformance: string;
  cancel: string;
  deletePerformanceDialogTitle: string;
  deletePerformanceDialogMessage: (name: string) => string;
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
  syncToSequencer: string;
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
  chord: string;
  octave: string;
  chordNoneOptgroup: string;
  chordDiatonicOptgroup: string;
  chordChromaticOptgroup: string;
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
    keyboardInfo: "8 octaves keyboard (C0..B7).",
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
    newPerformance: "New",
    addInstrument: "Add Instrument",
    savePerformance: "Save Performance",
    clonePerformance: "Clone",
    deletePerformance: "Delete",
    cancel: "Cancel",
    deletePerformanceDialogTitle: "Delete Performance?",
    deletePerformanceDialogMessage: (name) =>
      `This will permanently delete the performance "${name}".`,
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
    syncToSequencer: "Sync To",
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
    chord: "Chord",
    octave: "Octave",
    chordNoneOptgroup: "None",
    chordDiatonicOptgroup: "Diatonic",
    chordChromaticOptgroup: "Chromatic",
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
    keyboardInfo: "8-Oktaven-Tastatur (C0..B7).",
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
    newPerformance: "Neu",
    addInstrument: "Instrument hinzufuegen",
    savePerformance: "Performance speichern",
    clonePerformance: "Klonen",
    deletePerformance: "Loeschen",
    cancel: "Abbrechen",
    deletePerformanceDialogTitle: "Performance loeschen?",
    deletePerformanceDialogMessage: (name) =>
      `Die Performance "${name}" wird dauerhaft geloescht.`,
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
    syncToSequencer: "Sync zu",
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
    chord: "Akkord",
    octave: "Oktave",
    chordNoneOptgroup: "Kein Akkord",
    chordDiatonicOptgroup: "Diatonisch",
    chordChromaticOptgroup: "Chromatisch",
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
    keyboardInfo: "Clavier 8 octaves (C0..B7).",
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
    newPerformance: "Nouveau",
    addInstrument: "Ajouter instrument",
    savePerformance: "Enregistrer performance",
    clonePerformance: "Cloner",
    deletePerformance: "Supprimer",
    cancel: "Annuler",
    deletePerformanceDialogTitle: "Supprimer la performance ?",
    deletePerformanceDialogMessage: (name) =>
      `La performance "${name}" sera supprimee definitivement.`,
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
    syncToSequencer: "Sync vers",
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
    chord: "Accord",
    octave: "Octave",
    chordNoneOptgroup: "Aucun",
    chordDiatonicOptgroup: "Diatonique",
    chordChromaticOptgroup: "Chromatique",
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
    keyboardInfo: "Teclado de 8 octavas (C0..B7).",
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
    newPerformance: "Nuevo",
    addInstrument: "Agregar instrumento",
    savePerformance: "Guardar performance",
    clonePerformance: "Clonar",
    deletePerformance: "Eliminar",
    cancel: "Cancelar",
    deletePerformanceDialogTitle: "Eliminar performance?",
    deletePerformanceDialogMessage: (name) =>
      `La performance "${name}" se eliminara permanentemente.`,
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
    syncToSequencer: "Sync con",
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
    chord: "Acorde",
    octave: "Octava",
    chordNoneOptgroup: "Ninguno",
    chordDiatonicOptgroup: "Diatonico",
    chordChromaticOptgroup: "Cromatico",
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

function chordColorTextClass(color: "neutral" | "green" | "orange" | "red"): string {
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

function chordColorBorderClass(color: "neutral" | "green" | "orange" | "red"): string {
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

function chordOptionInlineStyle(color: "neutral" | "green" | "orange" | "red"): CSSProperties {
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
    const patternStartStep =
      typeof controllerSequencer.runtimePadStartStep === "number" && Number.isFinite(controllerSequencer.runtimePadStartStep)
        ? controllerSequencer.runtimePadStartStep
        : 0;
    const normalized = (((transportPosition - patternStartStep) % repeatLength) + repeatLength) % repeatLength;
    return clampControllerCurveUiPosition(normalized / repeatLength);
  }, [controllerSequencer.runtimePadStartStep, controllerSequencer.stepCount, playbackNow, playbackTransport]);
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
  onNewPerformance: () => void;
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
  onAddDrummerSequencerTrack: () => void;
  onAddControllerSequencer: () => void;
  onRemoveSequencerTrack: (trackId: string) => void;
  onSequencerTrackEnabledChange: (trackId: string, enabled: boolean) => void;
  onSequencerTrackChannelChange: (trackId: string, channel: number) => void;
  onSequencerTrackSyncTargetChange: (trackId: string, syncToTrackId: string | null) => void;
  onSequencerTrackScaleChange: (trackId: string, scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
  onSequencerTrackModeChange: (trackId: string, mode: SequencerMode) => void;
  onSequencerTrackStepCountChange: (trackId: string, count: 16 | 32) => void;
  onSequencerTrackStepNoteChange: (trackId: string, index: number, note: number | null) => void;
  onSequencerTrackStepChordChange: (trackId: string, index: number, chord: SequencerChord) => void;
  onSequencerTrackStepHoldChange: (trackId: string, index: number, hold: boolean) => void;
  onSequencerTrackStepVelocityChange: (trackId: string, index: number, velocity: number) => void;
  onSequencerTrackStepCopy: (
    sourceTrackId: string,
    sourceIndex: number,
    targetTrackId: string,
    targetIndex: number
  ) => void;
  onSequencerTrackClearSteps: (trackId: string) => void;
  onSequencerTrackReorder: (sourceTrackId: string, targetTrackId: string, position?: "before" | "after") => void;
  onSequencerPadPress: (trackId: string, padIndex: number) => void;
  onSequencerPadCopy: (trackId: string, sourcePadIndex: number, targetPadIndex: number) => void;
  onSequencerPadTransposeShort: (trackId: string, padIndex: number, direction: -1 | 1) => void;
  onSequencerPadTransposeLong: (trackId: string, padIndex: number, direction: -1 | 1) => void;
  onSequencerTrackPadLoopEnabledChange: (trackId: string, enabled: boolean) => void;
  onSequencerTrackPadLoopRepeatChange: (trackId: string, repeat: boolean) => void;
  onSequencerTrackPadLoopPatternChange: (trackId: string, pattern: PadLoopPatternState) => void;
  onSequencerTrackPadLoopStepAdd: (trackId: string, padIndex: number) => void;
  onSequencerTrackPadLoopStepRemove: (trackId: string, sequenceIndex: number) => void;
  onRemoveDrummerSequencerTrack: (trackId: string) => void;
  onDrummerSequencerTrackEnabledChange: (trackId: string, enabled: boolean) => void;
  onDrummerSequencerTrackChannelChange: (trackId: string, channel: number) => void;
  onDrummerSequencerTrackStepCountChange: (trackId: string, count: DrummerSequencerStepCount) => void;
  onDrummerSequencerRowAdd: (trackId: string) => void;
  onDrummerSequencerRowRemove: (trackId: string, rowId: string) => void;
  onDrummerSequencerRowKeyChange: (trackId: string, rowId: string, key: number) => void;
  onDrummerSequencerRowKeyPreview?: (key: number, channel: number) => void;
  onDrummerSequencerCellToggle: (trackId: string, rowId: string, stepIndex: number, active?: boolean) => void;
  onDrummerSequencerCellVelocityChange: (trackId: string, rowId: string, stepIndex: number, velocity: number) => void;
  onDrummerSequencerTrackClearSteps: (trackId: string) => void;
  onDrummerSequencerPadPress: (trackId: string, padIndex: number) => void;
  onDrummerSequencerPadCopy: (trackId: string, sourcePadIndex: number, targetPadIndex: number) => void;
  onDrummerSequencerTrackPadLoopEnabledChange: (trackId: string, enabled: boolean) => void;
  onDrummerSequencerTrackPadLoopRepeatChange: (trackId: string, repeat: boolean) => void;
  onDrummerSequencerTrackPadLoopPatternChange: (trackId: string, pattern: PadLoopPatternState) => void;
  onDrummerSequencerTrackPadLoopStepAdd: (trackId: string, padIndex: number) => void;
  onDrummerSequencerTrackPadLoopStepRemove: (trackId: string, sequenceIndex: number) => void;
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
  onControllerSequencerPadPress: (controllerSequencerId: string, padIndex: number) => void;
  onControllerSequencerPadCopy: (controllerSequencerId: string, sourcePadIndex: number, targetPadIndex: number) => void;
  onControllerSequencerClearSteps: (controllerSequencerId: string) => void;
  onControllerSequencerPadLoopEnabledChange: (controllerSequencerId: string, enabled: boolean) => void;
  onControllerSequencerPadLoopRepeatChange: (controllerSequencerId: string, repeat: boolean) => void;
  onControllerSequencerPadLoopPatternChange: (
    controllerSequencerId: string,
    pattern: PadLoopPatternState
  ) => void;
  onControllerSequencerPadLoopStepAdd: (controllerSequencerId: string, padIndex: number) => void;
  onControllerSequencerPadLoopStepRemove: (controllerSequencerId: string, sequenceIndex: number) => void;
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

function trackStateLabel(
  track: Pick<SequencerTrackState, "enabled" | "queuedEnabled">,
  ui: Pick<SequencerUiCopy, "trackQueuedStart" | "trackQueuedStop" | "running" | "stopped">
): string {
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

function dragEventHasMimeType(event: ReactDragEvent, mimeType: string): boolean {
  const types = event.dataTransfer?.types;
  if (!types) {
    return false;
  }
  return Array.from(types).includes(mimeType);
}

function parseSequencerTrackDragPayload(event: ReactDragEvent): SequencerTrackDragPayload | null {
  const raw =
    event.dataTransfer.getData(SEQUENCER_TRACK_DRAG_MIME) || event.dataTransfer.getData("text/plain");
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<
      SequencerTrackDragPayload & { padIndex?: unknown; stepIndex?: unknown }
    >;
    if (
      typeof parsed.trackId !== "string" ||
      parsed.trackId.trim().length === 0 ||
      parsed.padIndex !== undefined ||
      parsed.stepIndex !== undefined
    ) {
      return null;
    }
    return { trackId: parsed.trackId };
  } catch {
    return null;
  }
}

function parseSequencerStepDragPayload(event: ReactDragEvent): SequencerStepDragPayload | null {
  const raw =
    event.dataTransfer.getData(SEQUENCER_STEP_DRAG_MIME) || event.dataTransfer.getData("text/plain");
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SequencerStepDragPayload>;
    if (
      typeof parsed.trackId !== "string" ||
      typeof parsed.stepIndex !== "number" ||
      !Number.isFinite(parsed.stepIndex)
    ) {
      return null;
    }
    return {
      trackId: parsed.trackId,
      stepIndex: Math.round(parsed.stepIndex)
    };
  } catch {
    return null;
  }
}

function parsePadLoopItemDragPayload(event: ReactDragEvent): PadLoopItemDragPayload | null {
  const raw = event.dataTransfer.getData(PAD_LOOP_ITEM_DRAG_MIME);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PadLoopItemDragPayload>;
    if (
      !parsed.sourceContainer ||
      typeof parsed.sourceContainer !== "object" ||
      typeof parsed.sourceIndex !== "number" ||
      !Number.isFinite(parsed.sourceIndex)
    ) {
      return null;
    }
    const sourceContainer = parsed.sourceContainer as Partial<PadLoopContainerRef>;
    if (sourceContainer.kind === "root") {
      return {
        sourceContainer: { kind: "root" },
        sourceIndex: Math.round(parsed.sourceIndex)
      };
    }
    if (
      (sourceContainer.kind === "group" || sourceContainer.kind === "super") &&
      typeof sourceContainer.id === "string"
    ) {
      return {
        sourceContainer: {
          kind: sourceContainer.kind,
          id: sourceContainer.id
        },
        sourceIndex: Math.round(parsed.sourceIndex)
      };
    }
    return null;
  } catch {
    return null;
  }
}

function parsePadLoopReferenceDragPayload(event: ReactDragEvent): PadLoopReferenceDragPayload | null {
  const raw = event.dataTransfer.getData(PAD_LOOP_REF_DRAG_MIME);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PadLoopReferenceDragPayload>;
    if (!parsed.item || typeof parsed.item !== "object") {
      return null;
    }
    const item = parsed.item as Partial<PadLoopPatternItem>;
    if (item.type === "pad" && typeof item.padIndex === "number") {
      return {
        item: {
          type: "pad",
          padIndex: Math.max(0, Math.min(7, Math.round(item.padIndex)))
        }
      };
    }
    if (item.type === "group" && typeof item.groupId === "string") {
      return {
        item: {
          type: "group",
          groupId: item.groupId
        }
      };
    }
    if (item.type === "super" && typeof item.superGroupId === "string") {
      return {
        item: {
          type: "super",
          superGroupId: item.superGroupId
        }
      };
    }
    return null;
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

function padLoopContainerKey(container: PadLoopContainerRef): string {
  if (container.kind === "root") {
    return "root";
  }
  return `${container.kind}:${container.id}`;
}

function padLoopContainerLabel(container: PadLoopContainerRef): string {
  if (container.kind === "root") {
    return "Main";
  }
  return container.id;
}

function padLoopContainerFromItem(item: PadLoopPatternItem): PadLoopContainerRef | null {
  if (item.type === "group") {
    return { kind: "group", id: item.groupId };
  }
  if (item.type === "super") {
    return { kind: "super", id: item.superGroupId };
  }
  return null;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function padLoopTokenColors(item: PadLoopPatternItem, seed: number, selected: boolean, active: boolean): CSSProperties {
  const kind = itemColorKind(item);
  const hue = kind === "pad" ? 142 : kind === "group" ? 28 : 272;
  const shadeSeed = seed + (kind === "pad" ? 7 : kind === "group" ? 11 : 17);
  const light = 20 + (shadeSeed % 6) * 4;
  const borderAlpha = active ? 0.95 : selected ? 0.8 : 0.58;
  const bgAlpha = active ? 0.3 : selected ? 0.24 : 0.18;
  return {
    borderColor: `hsla(${hue}, 82%, ${Math.min(88, light + 32)}%, ${borderAlpha})`,
    backgroundColor: `hsla(${hue}, 85%, ${light}%, ${bgAlpha})`,
    color: `hsl(${hue}, 92%, 88%)`,
    boxShadow: active
      ? `0 0 0 1px hsla(${hue}, 90%, 70%, 0.5), inset 0 1px 0 hsla(${hue}, 90%, 90%, 0.08)`
      : selected
        ? `0 0 0 1px hsla(${hue}, 90%, 70%, 0.22) inset`
        : "inset 0 1px 0 rgba(255,255,255,0.03)"
  };
}

type PadLoopCompiledRange = {
  start: number;
  end: number;
};

type PadLoopRangeIndex = Record<string, PadLoopCompiledRange[][]>;

function buildPadLoopRangeIndex(pattern: PadLoopPatternState): PadLoopRangeIndex {
  const byKey: PadLoopRangeIndex = {};
  const groups = new Map(pattern.groups.map((group) => [group.id, group]));
  const superGroups = new Map(pattern.superGroups.map((group) => [group.id, group]));
  let cursor = 0;

  const ensureContainer = (containerKey: string, length: number): PadLoopCompiledRange[][] => {
    const current = byKey[containerKey] ?? [];
    if (current.length < length) {
      for (let index = current.length; index < length; index += 1) {
        current.push([]);
      }
    }
    byKey[containerKey] = current;
    return current;
  };

  const walkSequence = (
    container: PadLoopContainerRef,
    sequence: PadLoopPatternItem[],
    path: string[]
  ): void => {
    const containerKey = padLoopContainerKey(container);
    const containerRanges = ensureContainer(containerKey, sequence.length);

    for (let index = 0; index < sequence.length; index += 1) {
      const item = sequence[index];
      const start = cursor;
      if (!item) {
        containerRanges[index].push({ start, end: start });
        continue;
      }

      if (item.type === "pad") {
        cursor += 1;
      } else if (item.type === "group") {
        const refKey = `group:${item.groupId}`;
        if (!path.includes(refKey)) {
          const group = groups.get(item.groupId);
          if (group) {
            walkSequence({ kind: "group", id: item.groupId }, group.sequence, [...path, refKey]);
          }
        }
      } else if (item.type === "super") {
        const refKey = `super:${item.superGroupId}`;
        if (!path.includes(refKey)) {
          const group = superGroups.get(item.superGroupId);
          if (group) {
            walkSequence({ kind: "super", id: item.superGroupId }, group.sequence, [...path, refKey]);
          }
        }
      }

      containerRanges[index].push({ start, end: cursor });
    }
  };

  walkSequence({ kind: "root" }, pattern.rootSequence, []);
  return byKey;
}

type PadLoopEditorTrackLike = {
  id: string;
  enabled: boolean;
  padLoopEnabled: boolean;
  padLoopRepeat: boolean;
  padLoopPosition: number | null;
  padLoopPattern: PadLoopPatternState;
};

type PadLoopPatternEditorProps = {
  ui: Pick<
    SequencerUiCopy,
    "padLoopSequence" | "padLoopSequenceEmpty" | "padLoopSequenceHint" | "padLooper" | "repeat" | "on" | "off" | "remove"
  >;
  hostId: string;
  track: PadLoopEditorTrackLike;
  isPlaying: boolean;
  onPadLoopEnabledChange: (enabled: boolean) => void;
  onPadLoopRepeatChange: (repeat: boolean) => void;
  onPadLoopPatternChange: (pattern: PadLoopPatternState) => void;
};

type PadLoopContextMenuState = {
  x: number;
  y: number;
  container: PadLoopContainerRef;
};

function PadLoopPatternEditor({
  ui,
  hostId,
  track,
  isPlaying,
  onPadLoopEnabledChange,
  onPadLoopRepeatChange,
  onPadLoopPatternChange
}: PadLoopPatternEditorProps) {
  const [activeContainer, setActiveContainer] = useState<PadLoopContainerRef>({ kind: "root" });
  const [selectionByContainer, setSelectionByContainer] = useState<Record<string, number[]>>({});
  const [contextMenu, setContextMenu] = useState<PadLoopContextMenuState | null>(null);
  const [dropTarget, setDropTarget] = useState<{ containerKey: string; index: number } | null>(null);

  const compiledPattern = useMemo(() => compilePadLoopPattern(track.padLoopPattern), [track.padLoopPattern]);
  const rangeIndexByContainer = useMemo(() => buildPadLoopRangeIndex(track.padLoopPattern), [track.padLoopPattern]);

  useEffect(() => {
    if (activeContainer.kind === "root") {
      return;
    }
    if (getPadLoopContainerSequence(track.padLoopPattern, activeContainer) !== null) {
      return;
    }
    setActiveContainer({ kind: "root" });
  }, [activeContainer, track.padLoopPattern]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const handlePointerDown = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const selectedIndexesFor = useCallback(
    (container: PadLoopContainerRef): number[] => selectionByContainer[padLoopContainerKey(container)] ?? [],
    [selectionByContainer]
  );

  const setSelectionFor = useCallback((container: PadLoopContainerRef, nextIndexes: number[]) => {
    const key = padLoopContainerKey(container);
    const normalized = Array.from(new Set(nextIndexes.map((index) => Math.max(0, Math.round(index))))).sort(
      (a, b) => a - b
    );
    setSelectionByContainer((previous) =>
      normalized.length === 0 ? Object.fromEntries(Object.entries(previous).filter(([entryKey]) => entryKey !== key)) : { ...previous, [key]: normalized }
    );
  }, []);

  const commitPattern = useCallback(
    (nextPattern: PadLoopPatternState) => {
      onPadLoopPatternChange(nextPattern);
      setContextMenu(null);
    },
    [onPadLoopPatternChange]
  );

  const applyDrop = useCallback(
    (event: ReactDragEvent, container: PadLoopContainerRef, insertIndex: number) => {
      const padPayload = parseSequencerPadDragPayload(event);
      if (padPayload && padPayload.trackId === hostId) {
        const nextPattern = insertPadLoopItem(track.padLoopPattern, container, insertIndex, {
          type: "pad",
          padIndex: padPayload.padIndex
        });
        if (nextPattern !== track.padLoopPattern) {
          commitPattern(nextPattern);
        }
        return true;
      }

      const itemPayload = parsePadLoopItemDragPayload(event);
      if (itemPayload) {
        if (padLoopContainerKey(itemPayload.sourceContainer) !== padLoopContainerKey(container)) {
          return false;
        }
        const nextPattern = movePadLoopItemWithinContainer(
          track.padLoopPattern,
          container,
          itemPayload.sourceIndex,
          insertIndex
        );
        if (nextPattern !== track.padLoopPattern) {
          commitPattern(nextPattern);
        }
        return true;
      }

      const refPayload = parsePadLoopReferenceDragPayload(event);
      if (refPayload) {
        if (!canInsertItemIntoPadLoopContainer(track.padLoopPattern, container, refPayload.item)) {
          return false;
        }
        const nextPattern = insertPadLoopItem(track.padLoopPattern, container, insertIndex, refPayload.item);
        if (nextPattern !== track.padLoopPattern) {
          commitPattern(nextPattern);
        }
        return true;
      }

      return false;
    },
    [commitPattern, hostId, track.padLoopPattern]
  );

  const sequencePanel = useCallback(
    (container: PadLoopContainerRef, title: string, emphasis: "root" | "group" | "super") => {
      const sequence = getPadLoopContainerSequence(track.padLoopPattern, container) ?? [];
      const containerKey = padLoopContainerKey(container);
      const selectedIndexes = selectedIndexesFor(container);
      const selectedIndexSet = new Set(selectedIndexes);

      const openContextMenu = (event: ReactMouseEvent, fallbackSelection?: number[]) => {
        event.preventDefault();
        event.stopPropagation();
        if (fallbackSelection) {
          setSelectionFor(container, fallbackSelection);
        }
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          container
        });
      };

      const selectToken = (event: ReactMouseEvent, index: number, item: PadLoopPatternItem) => {
        event.stopPropagation();
        const current = selectedIndexesFor(container);
        if (event.metaKey || event.ctrlKey) {
          const next = current.includes(index) ? current.filter((value) => value !== index) : [...current, index];
          setSelectionFor(container, next);
        } else {
          setSelectionFor(container, [index]);
          if (item.type !== "pad") {
            const nested = padLoopContainerFromItem(item);
            if (nested) {
              setActiveContainer(nested);
            }
          }
        }
      };

      const containerHueClass =
        emphasis === "group"
          ? "border-orange-400/35 bg-orange-500/5"
          : emphasis === "super"
            ? "border-violet-400/35 bg-violet-500/5"
            : "border-slate-700 bg-slate-900/55";

      const panelLabelClass =
        emphasis === "group"
          ? "text-orange-200"
          : emphasis === "super"
            ? "text-violet-200"
            : "text-slate-300";

      return (
        <div className={`flex flex-col gap-1.5 rounded-lg border p-2 ${containerHueClass}`} key={`panel-${containerKey}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${panelLabelClass}`}>{title}</div>
            {container.kind !== "root" && (
              <button
                type="button"
                onClick={() => setActiveContainer({ kind: "root" })}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500"
              >
                Main
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {track.padLoopPattern.groups.map((group) => {
              const item: PadLoopPatternItem = { type: "group", groupId: group.id };
              const allowed = canInsertItemIntoPadLoopContainer(track.padLoopPattern, container, item);
              const isEditing = activeContainer.kind === "group" && activeContainer.id === group.id;
              return (
                <button
                  key={`${containerKey}-group-ref-${group.id}`}
                  type="button"
                  onClick={() => {
                    if (allowed) {
                      commitPattern(insertPadLoopItem(track.padLoopPattern, container, sequence.length, item));
                    }
                    setActiveContainer({ kind: "group", id: group.id });
                  }}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(PAD_LOOP_REF_DRAG_MIME, JSON.stringify({ item }));
                    event.dataTransfer.setData("text/plain", group.id);
                  }}
                  className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold transition ${
                    isEditing
                      ? "border-orange-300/80 bg-orange-500/20 text-orange-100"
                      : allowed
                        ? "border-orange-500/45 bg-orange-500/10 text-orange-200 hover:border-orange-300/70"
                        : "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                  }`}
                  title={allowed ? "Click to add / drag into sequence" : "Groups are not allowed in this level"}
                >
                  {group.id}
                </button>
              );
            })}
            {track.padLoopPattern.superGroups.map((group) => {
              const item: PadLoopPatternItem = { type: "super", superGroupId: group.id };
              const allowed = canInsertItemIntoPadLoopContainer(track.padLoopPattern, container, item);
              const isEditing = activeContainer.kind === "super" && activeContainer.id === group.id;
              return (
                <button
                  key={`${containerKey}-super-ref-${group.id}`}
                  type="button"
                  onClick={() => {
                    if (allowed) {
                      commitPattern(insertPadLoopItem(track.padLoopPattern, container, sequence.length, item));
                    }
                    setActiveContainer({ kind: "super", id: group.id });
                  }}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(PAD_LOOP_REF_DRAG_MIME, JSON.stringify({ item }));
                    event.dataTransfer.setData("text/plain", group.id);
                  }}
                  className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold transition ${
                    isEditing
                      ? "border-violet-300/80 bg-violet-500/20 text-violet-100"
                      : allowed
                        ? "border-violet-500/45 bg-violet-500/10 text-violet-200 hover:border-violet-300/70"
                        : "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                  }`}
                  title={allowed ? "Click to add / drag into sequence" : "Super-groups are not allowed in this level"}
                >
                  {group.id}
                </button>
              );
            })}
            {track.padLoopPattern.groups.length === 0 && track.padLoopPattern.superGroups.length === 0 && (
              <span className="text-[10px] text-slate-500">No groups yet. Select pads/groups, right-click, Group.</span>
            )}
          </div>

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
              commitPattern(insertPadLoopItem(track.padLoopPattern, container, sequence.length, { type: "pad", padIndex }));
            }}
            onClick={() => setSelectionFor(container, [])}
            onContextMenu={(event) => openContextMenu(event)}
            onDragOver={(event) => {
              if (
                !dragEventHasMimeType(event, SEQUENCER_PAD_DRAG_MIME) &&
                !dragEventHasMimeType(event, PAD_LOOP_ITEM_DRAG_MIME) &&
                !dragEventHasMimeType(event, PAD_LOOP_REF_DRAG_MIME)
              ) {
                return;
              }
              event.preventDefault();
              const itemDragPayload = parsePadLoopItemDragPayload(event);
              event.dataTransfer.dropEffect =
                itemDragPayload &&
                padLoopContainerKey(itemDragPayload.sourceContainer) === padLoopContainerKey(container)
                  ? "move"
                  : "copy";
              setDropTarget({ containerKey, index: sequence.length });
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDropTarget(null);
              applyDrop(event, container, sequence.length);
            }}
            onDragLeave={() => {
              setDropTarget((previous) => (previous?.containerKey === containerKey ? null : previous));
            }}
            className="min-h-[42px] rounded-md border border-dashed border-slate-700 bg-slate-950/75 px-2 py-1 outline-none ring-accent/40 transition focus:ring"
          >
            {sequence.length === 0 ? (
              <div className="flex min-h-[26px] items-center text-[10px] text-slate-500">{ui.padLoopSequenceEmpty}</div>
            ) : (
              <div className="flex min-h-[26px] flex-wrap items-center gap-1">
                {sequence.map((item, index) => {
                  const nestedContainer = padLoopContainerFromItem(item);
                  const isSelected = selectedIndexSet.has(index);
                  const itemRanges = rangeIndexByContainer[containerKey]?.[index] ?? [];
                  const isCurrentLoopStep =
                    track.padLoopEnabled &&
                    isPlaying &&
                    track.enabled &&
                    track.padLoopPosition !== null &&
                    itemRanges.some(
                      (range) =>
                        range.end > range.start &&
                        track.padLoopPosition !== null &&
                        track.padLoopPosition >= range.start &&
                        track.padLoopPosition < range.end
                    );
                  const dropBefore = dropTarget?.containerKey === containerKey && dropTarget.index === index;
                  const label = itemDisplayLabel(item);
                  const seed = item.type === "pad" ? item.padIndex : hashString(label);
                  const tokenStyle = padLoopTokenColors(item, seed + index, isSelected, isCurrentLoopStep);

                  return (
                    <Fragment key={`${containerKey}-item-${index}-${label}-${item.type}`}>
                      {dropBefore && <span className="h-5 w-[2px] rounded-full bg-accent/90" aria-hidden />}
                      <span
                        role="listitem"
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(
                            PAD_LOOP_ITEM_DRAG_MIME,
                            JSON.stringify({
                              sourceContainer: container,
                              sourceIndex: index
                            } satisfies PadLoopItemDragPayload)
                          );
                          event.dataTransfer.setData("text/plain", label);
                        }}
                        onDragOver={(event) => {
                          if (
                            !dragEventHasMimeType(event, SEQUENCER_PAD_DRAG_MIME) &&
                            !dragEventHasMimeType(event, PAD_LOOP_ITEM_DRAG_MIME) &&
                            !dragEventHasMimeType(event, PAD_LOOP_REF_DRAG_MIME)
                          ) {
                            return;
                          }
                          event.preventDefault();
                          setDropTarget({ containerKey, index });
                          const itemDragPayload = parsePadLoopItemDragPayload(event);
                          event.dataTransfer.dropEffect =
                            itemDragPayload &&
                            padLoopContainerKey(itemDragPayload.sourceContainer) === padLoopContainerKey(container)
                              ? "move"
                              : "copy";
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          setDropTarget({ containerKey, index });
                          applyDrop(event, container, index);
                        }}
                        onContextMenu={(event) => {
                          const current = selectedIndexesFor(container);
                          const fallbackSelection = current.includes(index) ? current : [index];
                          openContextMenu(event, fallbackSelection);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition"
                        style={tokenStyle}
                      >
                        <button
                          type="button"
                          onClick={(event) => selectToken(event, index, item)}
                          className="inline-flex items-center gap-1 rounded px-0.5 text-left outline-none"
                          title={
                            nestedContainer
                              ? `Click to edit ${nestedContainer.kind === "group" ? "group" : "super-group"} ${label}`
                              : `Pad ${label}`
                          }
                        >
                          <span className="font-mono">{label}</span>
                          {nestedContainer && (
                            <span
                              className={`text-[10px] ${
                                activeContainer.kind !== "root" &&
                                activeContainer.kind === nestedContainer.kind &&
                                activeContainer.id === nestedContainer.id
                                  ? "text-white"
                                  : "text-slate-200/80"
                              }`}
                              aria-hidden
                            >
                              ▾
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            commitPattern(removePadLoopItemsFromContainer(track.padLoopPattern, container, [index]));
                          }}
                          className="rounded px-1 text-[10px] leading-none text-slate-200/75 transition hover:bg-black/20 hover:text-rose-200"
                          aria-label={`${ui.remove} ${label}`}
                          title={ui.remove}
                        >
                          x
                        </button>
                      </span>
                    </Fragment>
                  );
                })}
                {dropTarget?.containerKey === containerKey && dropTarget.index === sequence.length && (
                  <span className="h-5 w-[2px] rounded-full bg-accent/90" aria-hidden />
                )}
                <span className="text-[10px] text-slate-500">{ui.padLoopSequenceHint}</span>
              </div>
            )}
          </div>
        </div>
      );
    },
    [
      activeContainer,
      applyDrop,
      commitPattern,
      dropTarget,
      hostId,
      isPlaying,
      rangeIndexByContainer,
      selectedIndexesFor,
      setSelectionFor,
      track.enabled,
      track.padLoopEnabled,
      track.padLoopPattern,
      track.padLoopPosition,
      ui.padLoopSequence,
      ui.padLoopSequenceEmpty,
      ui.padLoopSequenceHint,
      ui.remove
    ]
  );

  const contextMenuSelection = contextMenu ? selectedIndexesFor(contextMenu.container) : [];
  const hasUngroupableSelection =
    contextMenu !== null &&
    contextMenuSelection.some((index) => {
      const sequence = getPadLoopContainerSequence(track.padLoopPattern, contextMenu.container) ?? [];
      const item = sequence[index];
      return item && item.type !== "pad";
    });
  const canCreateGroup =
    contextMenu !== null &&
    canCreatePadLoopGroupFromSelection(track.padLoopPattern, contextMenu.container, contextMenuSelection, "group");
  const canCreateSuperGroup =
    contextMenu !== null &&
    canCreatePadLoopGroupFromSelection(track.padLoopPattern, contextMenu.container, contextMenuSelection, "super");
  const canRemoveSelection = contextMenuSelection.length > 0;

  return (
    <div className="flex min-w-[300px] flex-1 flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{ui.padLoopSequence}</span>
      <div className="flex flex-col gap-1.5 rounded-lg border border-slate-600 bg-slate-950 p-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPadLoopEnabledChange(!track.padLoopEnabled)}
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
            onClick={() => onPadLoopRepeatChange(!track.padLoopRepeat)}
            className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
              track.padLoopRepeat
                ? "border-emerald-400/55 bg-emerald-500/10 text-emerald-300"
                : "border-amber-400/55 bg-amber-500/10 text-amber-300"
            }`}
            aria-pressed={track.padLoopRepeat}
          >
            {ui.repeat}: {track.padLoopRepeat ? ui.on : ui.off}
          </button>
          <div className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-300">
            compiled: {compiledPattern.sequence.length}
          </div>
        </div>

        {sequencePanel({ kind: "root" }, "Main Sequence", "root")}

        {activeContainer.kind !== "root" &&
          sequencePanel(
            activeContainer,
            `${activeContainer.kind === "group" ? "Group" : "Super-group"} ${padLoopContainerLabel(activeContainer)}`,
            activeContainer.kind
          )}
      </div>

      {contextMenu && (
        <div
          className="fixed z-[1600] w-48 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            {padLoopContainerLabel(contextMenu.container)}
          </div>
          <button
            type="button"
            disabled={!canCreateGroup}
            onClick={() => {
              if (!contextMenu) {
                return;
              }
              commitPattern(
                groupPadLoopItemsInContainer(
                  track.padLoopPattern,
                  contextMenu.container,
                  selectedIndexesFor(contextMenu.container),
                  "group"
                )
              );
            }}
            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition ${
              canCreateGroup
                ? "text-slate-200 hover:bg-slate-800"
                : "cursor-not-allowed text-slate-500"
            }`}
          >
            <span>Group</span>
            <span className="text-[10px] text-orange-300">A..Z</span>
          </button>
          <button
            type="button"
            disabled={!canCreateSuperGroup}
            onClick={() => {
              if (!contextMenu) {
                return;
              }
              commitPattern(
                groupPadLoopItemsInContainer(
                  track.padLoopPattern,
                  contextMenu.container,
                  selectedIndexesFor(contextMenu.container),
                  "super"
                )
              );
            }}
            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition ${
              canCreateSuperGroup
                ? "text-slate-200 hover:bg-slate-800"
                : "cursor-not-allowed text-slate-500"
            }`}
          >
            <span>Super-group</span>
            <span className="text-[10px] text-violet-300">I..X</span>
          </button>
          <button
            type="button"
            disabled={!hasUngroupableSelection}
            onClick={() => {
              if (!contextMenu) {
                return;
              }
              commitPattern(
                ungroupPadLoopItemsInContainer(
                  track.padLoopPattern,
                  contextMenu.container,
                  selectedIndexesFor(contextMenu.container)
                )
              );
            }}
            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition ${
              hasUngroupableSelection
                ? "text-slate-200 hover:bg-slate-800"
                : "cursor-not-allowed text-slate-500"
            }`}
          >
            <span>Ungroup</span>
            <span className="text-[10px] text-slate-400">inline</span>
          </button>
          <button
            type="button"
            disabled={!canRemoveSelection}
            onClick={() => {
              if (!contextMenu) {
                return;
              }
              const container = contextMenu.container;
              commitPattern(
                removePadLoopItemsFromContainer(track.padLoopPattern, container, selectedIndexesFor(container))
              );
            }}
            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition ${
              canRemoveSelection
                ? "text-rose-200 hover:bg-rose-500/10"
                : "cursor-not-allowed text-slate-500"
            }`}
          >
            <span>{ui.remove}</span>
            <span className="text-[10px] text-slate-400">{contextMenuSelection.length || 0}</span>
          </button>
        </div>
      )}
    </div>
  );
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
  onNewPerformance,
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
  onAddDrummerSequencerTrack,
  onAddControllerSequencer,
  onRemoveSequencerTrack,
  onSequencerTrackEnabledChange,
  onSequencerTrackChannelChange,
  onSequencerTrackSyncTargetChange,
  onSequencerTrackScaleChange,
  onSequencerTrackModeChange,
  onSequencerTrackStepCountChange,
  onSequencerTrackStepNoteChange,
  onSequencerTrackStepChordChange,
  onSequencerTrackStepHoldChange,
  onSequencerTrackStepVelocityChange,
  onSequencerTrackStepCopy,
  onSequencerTrackClearSteps,
  onSequencerTrackReorder,
  onSequencerPadPress,
  onSequencerPadCopy,
  onSequencerPadTransposeShort,
  onSequencerPadTransposeLong,
  onSequencerTrackPadLoopEnabledChange,
  onSequencerTrackPadLoopRepeatChange,
  onSequencerTrackPadLoopPatternChange,
  onSequencerTrackPadLoopStepAdd,
  onSequencerTrackPadLoopStepRemove,
  onRemoveDrummerSequencerTrack,
  onDrummerSequencerTrackEnabledChange,
  onDrummerSequencerTrackChannelChange,
  onDrummerSequencerTrackStepCountChange,
  onDrummerSequencerRowAdd,
  onDrummerSequencerRowRemove,
  onDrummerSequencerRowKeyChange,
  onDrummerSequencerRowKeyPreview,
  onDrummerSequencerCellToggle,
  onDrummerSequencerCellVelocityChange,
  onDrummerSequencerTrackClearSteps,
  onDrummerSequencerPadPress,
  onDrummerSequencerPadCopy,
  onDrummerSequencerTrackPadLoopEnabledChange,
  onDrummerSequencerTrackPadLoopRepeatChange,
  onDrummerSequencerTrackPadLoopPatternChange,
  onDrummerSequencerTrackPadLoopStepAdd,
  onDrummerSequencerTrackPadLoopStepRemove,
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
  onControllerSequencerPadPress,
  onControllerSequencerPadCopy,
  onControllerSequencerClearSteps,
  onControllerSequencerPadLoopEnabledChange,
  onControllerSequencerPadLoopRepeatChange,
  onControllerSequencerPadLoopPatternChange,
  onControllerSequencerPadLoopStepAdd,
  onControllerSequencerPadLoopStepRemove,
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
  const totalPerformDevices =
    sequencer.tracks.length +
    sequencer.drummerTracks.length +
    sequencer.controllerSequencers.length +
    sequencer.pianoRolls.length +
    sequencer.midiControllers.length;
  const canRemovePerformDevice = totalPerformDevices > 1;
  const selectedPerformance = useMemo(
    () => performances.find((performance) => performance.id === currentPerformanceId) ?? null,
    [currentPerformanceId, performances]
  );
  const deletePerformanceTargetName =
    selectedPerformance?.name.trim() ||
    performanceName.trim() ||
    (currentPerformanceId ? `#${currentPerformanceId}` : ui.current);

  const configFileInputRef = useRef<HTMLInputElement | null>(null);
  const [stepSelectPreview, setStepSelectPreview] = useState<Record<string, string>>({});
  const [pendingStartAllPianoRolls, setPendingStartAllPianoRolls] = useState(false);
  const [deletePerformanceDialogOpen, setDeletePerformanceDialogOpen] = useState(false);
  const padTransposePressRef = useRef<Record<string, { timerId: number; longPressTriggered: boolean }>>({});
  const drummerLedDragRef = useRef<{
    pointerId: number;
    trackId: string;
    rowId: string;
    stepIndex: number;
    startY: number;
    startVelocity: number;
    startedActive: boolean;
    moved: boolean;
  } | null>(null);
  const triggerConfigLoad = useCallback(() => {
    configFileInputRef.current?.click();
  }, []);

  useEffect(() => {
    return () => {
      for (const key of Object.keys(padTransposePressRef.current)) {
        window.clearTimeout(padTransposePressRef.current[key].timerId);
      }
      padTransposePressRef.current = {};
      drummerLedDragRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!deletePerformanceDialogOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDeletePerformanceDialogOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deletePerformanceDialogOpen]);

  useEffect(() => {
    if (currentPerformanceId) {
      return;
    }
    setDeletePerformanceDialogOpen(false);
  }, [currentPerformanceId]);

  const enableAllNonPianoRollDevices = useCallback(() => {
    for (const track of sequencer.tracks) {
      if (!track.enabled) {
        onSequencerTrackEnabledChange(track.id, true);
      }
    }
    for (const track of sequencer.drummerTracks) {
      if (!track.enabled) {
        onDrummerSequencerTrackEnabledChange(track.id, true);
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
    onDrummerSequencerTrackEnabledChange,
    onControllerSequencerEnabledChange,
    onMidiControllerEnabledChange,
    onSequencerTrackEnabledChange,
    sequencer.controllerSequencers,
    sequencer.drummerTracks,
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
    for (const track of sequencer.drummerTracks) {
      if (track.enabled || track.queuedEnabled === true) {
        onDrummerSequencerTrackEnabledChange(track.id, false);
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
    onDrummerSequencerTrackEnabledChange,
    onControllerSequencerEnabledChange,
    onMidiControllerEnabledChange,
    onPianoRollEnabledChange,
    onSequencerTrackEnabledChange,
    sequencer.controllerSequencers,
    sequencer.drummerTracks,
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

  const openDeletePerformanceDialog = useCallback(() => {
    if (!currentPerformanceId) {
      return;
    }
    setDeletePerformanceDialogOpen(true);
  }, [currentPerformanceId]);

  const closeDeletePerformanceDialog = useCallback(() => {
    setDeletePerformanceDialogOpen(false);
  }, []);

  const confirmDeletePerformance = useCallback(() => {
    setDeletePerformanceDialogOpen(false);
    onDeletePerformance();
  }, [onDeletePerformance]);

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

  const handleDrummerLedPointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      trackId: string,
      rowId: string,
      stepIndex: number,
      active: boolean,
      velocity: number
    ) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      if (!active) {
        onDrummerSequencerCellToggle(trackId, rowId, stepIndex, true);
      }
      drummerLedDragRef.current = {
        pointerId: event.pointerId,
        trackId,
        rowId,
        stepIndex,
        startY: event.clientY,
        startVelocity: Math.max(0, Math.min(127, Math.round(velocity))),
        startedActive: active,
        moved: false
      };
    },
    [onDrummerSequencerCellToggle]
  );

  const handleDrummerLedPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = drummerLedDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      const deltaY = drag.startY - event.clientY;
      const nextVelocity = Math.max(0, Math.min(127, drag.startVelocity + Math.round(deltaY)));
      if (Math.abs(deltaY) >= 2) {
        drag.moved = true;
      }
      onDrummerSequencerCellVelocityChange(drag.trackId, drag.rowId, drag.stepIndex, nextVelocity);
    },
    [onDrummerSequencerCellVelocityChange]
  );

  const handleDrummerLedPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = drummerLedDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!drag.moved && drag.startedActive) {
        onDrummerSequencerCellToggle(drag.trackId, drag.rowId, drag.stepIndex, false);
      }
      drummerLedDragRef.current = null;
    },
    [onDrummerSequencerCellToggle]
  );

  const cancelDrummerLedPointer = useCallback(() => {
    drummerLedDragRef.current = null;
  }, []);

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
    <>
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
            onClick={onNewPerformance}
            className="rounded-md border border-slate-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
          >
            {ui.newPerformance}
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
          <button
            type="button"
            onClick={openDeletePerformanceDialog}
            disabled={!currentPerformanceId}
            className="ml-auto rounded-md border border-rose-500/60 bg-rose-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ui.deletePerformance}
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
                className="grid grid-cols-[minmax(0,_1fr)_88px_minmax(0,_1fr)] items-end gap-2 rounded-lg border border-slate-600/80 bg-slate-800/75 px-2 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
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
                  className="justify-self-end rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25"
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
            onClick={onAddDrummerSequencerTrack}
            className="rounded-md border border-rose-400/60 bg-rose-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/20"
          >
            Drummer
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
            const trackDisplayLabel = ui.sequencerWithIndex(trackIndex + 1);
            const syncTargetValue = track.syncToTrackId ?? "";

            return (
              <article
                key={track.id}
                onDragOver={(event) => {
                  if (!dragEventHasMimeType(event, SEQUENCER_TRACK_DRAG_MIME)) {
                    return;
                  }
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  const payload = parseSequencerTrackDragPayload(event);
                  if (!payload || payload.trackId === track.id) {
                    return;
                  }
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const position = event.clientY >= rect.top + rect.height / 2 ? "after" : "before";
                  onSequencerTrackReorder(payload.trackId, track.id, position);
                }}
                className="relative rounded-xl border border-slate-700 bg-slate-900/65 p-2.5 pr-10"
              >
                {onHelpRequest ? (
                  <HelpIconButton
                    guiLanguage={guiLanguage}
                    onClick={() => onHelpRequest("sequencer_track_editor")}
                    className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-500 bg-slate-950/90 text-xs font-bold text-slate-100 transition hover:border-accent hover:text-accent"
                  />
                ) : null}
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div
                    draggable
                    onDragStart={(event) => {
                      event.stopPropagation();
                      const payload = JSON.stringify({ trackId: track.id });
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(SEQUENCER_TRACK_DRAG_MIME, payload);
                      event.dataTransfer.setData("text/plain", payload);
                    }}
                    className="inline-flex cursor-grab select-none items-center rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 active:cursor-grabbing"
                    aria-label={`${trackDisplayLabel}: drag to reorder`}
                    title="Drag to reorder sequencers"
                  >
                    ::
                  </div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">
                    {trackDisplayLabel}
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
                    onClick={() => onSequencerTrackClearSteps(track.id)}
                    className="ml-2 rounded-md border border-slate-500/70 bg-slate-800/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400 hover:bg-slate-700"
                  >
                    {ui.clearSteps}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveSequencerTrack(track.id)}
                    disabled={!canRemovePerformDevice}
                    className="ml-auto rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {ui.remove}
                  </button>
                </div>

                <div className="mb-2 grid gap-2 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] lg:items-start">
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-end gap-2">
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

                      <label className="flex min-w-[170px] flex-1 flex-col gap-1">
                        <span className={controlLabelClass}>{ui.syncToSequencer}</span>
                        <select
                          value={syncTargetValue}
                          onChange={(event) =>
                            onSequencerTrackSyncTargetChange(
                              track.id,
                              event.target.value.trim().length > 0 ? event.target.value : null
                            )
                          }
                          className={controlFieldClass}
                        >
                          <option value="">{ui.none}</option>
                          {sequencer.tracks.map((candidateTrack, candidateIndex) => {
                            if (candidateTrack.id === track.id) {
                              return null;
                            }
                            return (
                              <option key={`${track.id}-sync-${candidateTrack.id}`} value={candidateTrack.id}>
                                {ui.sequencerWithIndex(candidateIndex + 1)}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex min-w-[180px] flex-1 flex-col gap-1">
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

                      <label className="flex min-w-[160px] flex-1 flex-col gap-1">
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
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
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
                  </div>

                  <PadLoopPatternEditor
                    ui={ui}
                    hostId={track.id}
                    track={track}
                    isPlaying={sequencer.isPlaying}
                    onPadLoopEnabledChange={(enabled) => onSequencerTrackPadLoopEnabledChange(track.id, enabled)}
                    onPadLoopRepeatChange={(repeat) => onSequencerTrackPadLoopRepeatChange(track.id, repeat)}
                    onPadLoopPatternChange={(pattern) => onSequencerTrackPadLoopPatternChange(track.id, pattern)}
                  />
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
                      const padHasContent = (track.pads[padIndex]?.steps ?? []).some((step) => step.note !== null);
                      const inactivePadMainClass = padHasContent
                        ? "border-cyan-700/65 bg-slate-900 text-cyan-100 hover:border-cyan-500/70 hover:bg-slate-800/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_0_1px_rgba(34,211,238,0.08)]"
                        : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500";
                      const padAccentClass = isActivePad
                        ? "border-accent/70 bg-accent/10 text-accent hover:bg-accent/15"
                        : isQueuedPad
                          ? "border-amber-400/60 bg-amber-500/5 text-amber-300 hover:bg-amber-500/10"
                          : padHasContent
                            ? "border-cyan-800/70 bg-cyan-500/5 text-cyan-200 hover:border-cyan-600/80 hover:bg-cyan-500/10"
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
                                  : inactivePadMainClass
                            }`}
                          >
                            P{padIndex + 1}
                          </button>
                          {padHasContent ? (
                            <span
                              className="pointer-events-none absolute right-1 top-1 z-20 h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.7)]"
                              aria-hidden="true"
                            />
                          ) : null}
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
                      gridTemplateColumns: `repeat(${track.stepCount}, minmax(112px, 1fr))`,
                      minWidth: `${Math.max(760, track.stepCount * 116)}px`
                    }}
                  >
                    {stepIndices.map((step) => {
                      const stepState = track.steps[step];
                      const noteValue = stepState?.note ?? null;
                      const holdActive = stepState?.hold === true;
                      const stepVelocity = stepState?.velocity ?? 127;
                      const localPlayhead =
                        typeof track.runtimeLocalStep === "number"
                          ? track.runtimeLocalStep % track.stepCount
                          : sequencer.playhead % track.stepCount;
                      const isActive = track.enabled && sequencer.isPlaying && localPlayhead === step;
                      const selectedNote = noteValue === null ? null : noteOptionsByNote.get(noteValue) ?? null;
                      const isInScale = selectedNote?.inScale ?? false;
                      const degree = selectedNote?.degree ?? null;
                      const notePitchClass = noteValue === null ? null : midiNotePitchClass(noteValue);
                      const noteOctave = noteValue === null ? null : midiNoteOctave(noteValue);
                      const chordValue = stepState?.chord ?? "none";
                      const chordOptions = buildSequencerChordOptions(noteValue, track.scaleRoot, track.mode);
                      const chordNoneOptions = chordOptions.filter((option) => option.group === "none");
                      const chordDiatonicOptions = chordOptions.filter((option) => option.group === "diatonic");
                      const chordChromaticOptions = chordOptions.filter((option) => option.group === "chromatic");
                      const selectedChordOption =
                        chordOptions.find((option) => option.value === chordValue) ??
                        chordOptions.find((option) => option.value === "none") ??
                        chordOptions[0];
                      const selectedChordLabel = selectedChordOption?.label ?? "none";
                      const selectedChordColor = selectedChordOption?.color ?? "neutral";
                      const chordStatusText =
                        noteValue === null || chordValue === "none"
                          ? null
                          : selectedChordOption?.group === "diatonic"
                            ? "diatonic"
                            : selectedChordOption?.inScaleToneCount && selectedChordOption.inScaleToneCount > 0
                              ? "chromatic / partial in-scale"
                              : "chromatic / out of scale";
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
                          onDragOver={(event) => {
                            if (!dragEventHasMimeType(event, SEQUENCER_STEP_DRAG_MIME)) {
                              return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            event.dataTransfer.dropEffect = "copy";
                          }}
                          onDrop={(event) => {
                            const payload = parseSequencerStepDragPayload(event);
                            if (!payload) {
                              return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            if (payload.trackId === track.id && payload.stepIndex === step) {
                              return;
                            }
                            onSequencerTrackStepCopy(payload.trackId, payload.stepIndex, track.id, step);
                          }}
                          className={`rounded-md border p-1.5 transition ${
                            isActive
                              ? "border-accent bg-accent/15 shadow-[0_0_0_1px_rgba(14,165,233,0.55)]"
                              : isInScale
                                ? "border-emerald-500/70 bg-emerald-900/20"
                                : "border-slate-700 bg-slate-900"
                          }`}
                        >
                          <div className="relative pl-5 pr-12 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
                            <div
                              draggable
                              onDragStart={(event) => {
                                event.stopPropagation();
                                const payload = JSON.stringify({ trackId: track.id, stepIndex: step });
                                event.dataTransfer.effectAllowed = "copy";
                                event.dataTransfer.setData(SEQUENCER_STEP_DRAG_MIME, payload);
                                event.dataTransfer.setData("text/plain", payload);
                              }}
                              className="absolute left-0 top-0 inline-flex cursor-grab select-none rounded px-1 py-0.5 text-[8px] text-slate-500 hover:bg-slate-800/80 hover:text-slate-300 active:cursor-grabbing"
                              aria-label={`Step ${step + 1}: drag to copy settings`}
                              title="Drag onto another step to copy note/chord/octave/velocity"
                            >
                              ::
                            </div>
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

                          <label
                            className={`mt-1 flex items-center gap-1.5 rounded-md border bg-slate-950/70 px-2 py-1 ${chordColorBorderClass(selectedChordColor)}`}
                          >
                            <span className="shrink-0 text-[9px] uppercase tracking-[0.16em] text-slate-400">CHD</span>
                            <div className="relative min-w-0 flex-1">
                              <select
                                disabled={noteValue === null}
                                value={chordValue}
                                onChange={(event) =>
                                  onSequencerTrackStepChordChange(track.id, step, event.target.value as SequencerChord)
                                }
                                className="h-6 w-full appearance-none rounded border border-slate-600 bg-slate-950 px-1.5 py-0.5 text-center font-mono text-[10px] text-transparent outline-none ring-accent/40 transition focus:ring disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label={`${ui.chord} ${step + 1}`}
                              >
                                <optgroup label={ui.chordNoneOptgroup}>
                                  {chordNoneOptions.map((option) => (
                                    <option
                                      key={`${track.id}-step-${step}-chord-${option.value}`}
                                      value={option.value}
                                      style={chordOptionInlineStyle(option.color)}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </optgroup>
                                <optgroup label={ui.chordDiatonicOptgroup}>
                                  {chordDiatonicOptions.map((option) => (
                                    <option
                                      key={`${track.id}-step-${step}-chord-${option.value}`}
                                      value={option.value}
                                      style={chordOptionInlineStyle(option.color)}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </optgroup>
                                <optgroup label={ui.chordChromaticOptgroup}>
                                  {chordChromaticOptions.map((option) => (
                                    <option
                                      key={`${track.id}-step-${step}-chord-${option.value}`}
                                      value={option.value}
                                      style={chordOptionInlineStyle(option.color)}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </optgroup>
                              </select>
                              <div
                                className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-semibold tracking-[0.08em] ${chordColorTextClass(selectedChordColor)}`}
                              >
                                {selectedChordLabel}
                              </div>
                            </div>
                          </label>

                          {chordStatusText ? (
                            <div className={`mt-1 text-center text-[9px] tracking-[0.12em] ${chordColorTextClass(selectedChordColor)}`}>
                              {chordStatusText}
                            </div>
                          ) : null}

                          <label className="mt-1 flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1">
                            <span className="shrink-0 text-[9px] uppercase tracking-[0.16em] text-slate-400">OCT</span>
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

                          <label className="mt-1 flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1">
                            <span className="shrink-0 text-[9px] uppercase tracking-[0.16em] text-slate-400">VEL</span>
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

          {sequencer.drummerTracks.length > 0 ? (
            <div className="rounded-xl border border-rose-800/45 bg-slate-900/45 p-2.5">
              <div className="mb-2 text-xs uppercase tracking-[0.2em] text-rose-200">Drummer Sequencers</div>
              <div className="space-y-3">
                {sequencer.drummerTracks.map((track, trackIndex) => {
                  const stepIndices = Array.from({ length: track.stepCount }, (_, index) => index);
                  const localPlayhead =
                    typeof track.runtimeLocalStep === "number"
                      ? track.runtimeLocalStep % track.stepCount
                      : sequencer.playhead % track.stepCount;

                  return (
                    <article
                      key={track.id}
                      className="relative rounded-xl border border-slate-700 bg-slate-900/70 p-2.5 pr-10"
                    >
                      {onHelpRequest ? (
                        <HelpIconButton
                          guiLanguage={guiLanguage}
                          onClick={() => onHelpRequest("sequencer_drummer_sequencer")}
                          className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-500 bg-slate-950/90 text-xs font-bold text-slate-100 transition hover:border-accent hover:text-accent"
                        />
                      ) : null}

                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">
                          Drummer {trackIndex + 1}
                        </div>
                        <span className={transportStateClass}>{trackStateLabel(track, ui)}</span>
                        <button
                          type="button"
                          onClick={() => onDrummerSequencerTrackEnabledChange(track.id, !track.enabled)}
                          disabled={!instrumentsRunning && !track.enabled}
                          className={track.enabled ? transportStopButtonClass : transportStartButtonClass}
                        >
                          {track.enabled ? ui.stop : ui.start}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDrummerSequencerTrackClearSteps(track.id)}
                          className="ml-2 rounded-md border border-slate-500/70 bg-slate-800/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400 hover:bg-slate-700"
                        >
                          {ui.clearSteps}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDrummerSequencerRowAdd(track.id)}
                          className="rounded-md border border-rose-400/60 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/20"
                        >
                          + Key
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveDrummerSequencerTrack(track.id)}
                          disabled={!canRemovePerformDevice}
                          className="ml-auto rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
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
                            onChange={(event) => onDrummerSequencerTrackChannelChange(track.id, Number(event.target.value))}
                            className={`${controlFieldClass} w-24`}
                          />
                        </label>

                        <div className="flex flex-col gap-1">
                          <span className={controlLabelClass}>{ui.steps}</span>
                          <div className="inline-flex rounded-lg border border-slate-600 bg-slate-950 p-1">
                            {[4, 8, 16, 32].map((count) => (
                              <button
                                key={`${track.id}-drum-steps-${count}`}
                                type="button"
                                onClick={() =>
                                  onDrummerSequencerTrackStepCountChange(track.id, count as DrummerSequencerStepCount)
                                }
                                className={`rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                                  track.stepCount === count
                                    ? "bg-rose-500/20 text-rose-200"
                                    : "text-slate-300 hover:bg-slate-800"
                                }`}
                              >
                                {count}
                              </button>
                            ))}
                          </div>
                        </div>

                        <PadLoopPatternEditor
                          ui={ui}
                          hostId={track.id}
                          track={track}
                          isPlaying={sequencer.isPlaying}
                          onPadLoopEnabledChange={(enabled) => onDrummerSequencerTrackPadLoopEnabledChange(track.id, enabled)}
                          onPadLoopRepeatChange={(repeat) => onDrummerSequencerTrackPadLoopRepeatChange(track.id, repeat)}
                          onPadLoopPatternChange={(pattern) =>
                            onDrummerSequencerTrackPadLoopPatternChange(track.id, pattern)
                          }
                        />
                      </div>

                      <div className="mb-2">
                        <div className="mb-1 text-xs uppercase tracking-[0.2em] text-slate-400">{ui.patternPads}</div>
                        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                          {Array.from({ length: 8 }, (_, padIndex) => {
                            const isActivePad = track.activePad === padIndex;
                            const isQueuedPad = track.queuedPad === padIndex;
                            const padHasContent = (track.pads[padIndex]?.rows ?? []).some((row) =>
                              row.steps.some((cell) => cell.active)
                            );
                            const inactivePadMainClass = padHasContent
                              ? "border-rose-700/65 bg-slate-900 text-rose-100 hover:border-rose-500/70 hover:bg-slate-800/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_0_1px_rgba(251,113,133,0.08)]"
                              : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500";
                            return (
                              <div key={`${track.id}-drum-pad-${padIndex}`} className="relative">
                                <button
                                  type="button"
                                  draggable
                                  onClick={() => onDrummerSequencerPadPress(track.id, padIndex)}
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
                                    onDrummerSequencerPadCopy(track.id, payload.padIndex, padIndex);
                                  }}
                                  className={`w-full rounded-md border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                                    isActivePad
                                      ? "border-rose-400 bg-rose-500/20 text-rose-100"
                                      : isQueuedPad
                                        ? "border-amber-400/70 bg-amber-500/10 text-amber-300"
                                        : inactivePadMainClass
                                  }`}
                                >
                                  P{padIndex + 1}
                                </button>
                                {padHasContent ? (
                                  <span
                                    className="pointer-events-none absolute right-1 top-1 z-20 h-1.5 w-1.5 rounded-full bg-rose-300 shadow-[0_0_8px_rgba(251,113,133,0.7)]"
                                    aria-hidden="true"
                                  />
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="overflow-x-auto pb-1">
                        <div
                          className="grid w-full items-center gap-x-1 gap-y-1"
                          style={{
                            gridTemplateColumns: `minmax(136px, 136px) repeat(${track.stepCount}, minmax(20px, 1fr))`,
                            minWidth: `${136 + track.stepCount * 21}px`
                          }}
                        >
                          <div className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                            Keys
                          </div>
                          {stepIndices.map((step) => {
                            const isCurrentStep = track.enabled && sequencer.isPlaying && localPlayhead === step;
                            return (
                              <div
                                key={`${track.id}-drum-header-${step}`}
                                className={`flex h-5 min-w-0 items-center justify-center rounded border font-mono text-[9px] ${
                                  isCurrentStep
                                    ? "border-emerald-400/80 bg-emerald-400/15 text-emerald-200"
                                    : "border-slate-700 bg-slate-950/70 text-slate-400"
                                }`}
                              >
                                {step + 1}
                              </div>
                            );
                          })}

                          {track.rows.map((row, rowIndex) => {
                            const activePad = track.pads[track.activePad];
                            const padRow = activePad?.rows.find((candidate) => candidate.rowId === row.id) ?? null;
                            return (
                              <Fragment key={`${track.id}-drum-row-${row.id}`}>
                                <div className="flex h-7 items-center gap-0.5 rounded-md border border-slate-700 bg-slate-950/70 px-1">
                                  <span className="w-4 text-center font-mono text-[9px] text-slate-500">
                                    {rowIndex + 1}
                                  </span>
                                  <input
                                    type="number"
                                    min={0}
                                    max={127}
                                    step={1}
                                    value={row.key}
                                    onChange={(event) => {
                                      const raw = event.target.value.trim();
                                      if (raw.length === 0) {
                                        return;
                                      }
                                      const nextKey = Number(raw);
                                      onDrummerSequencerRowKeyChange(track.id, row.id, nextKey);
                                      onDrummerSequencerRowKeyPreview?.(nextKey, track.midiChannel);
                                    }}
                                    className="w-14 rounded border border-slate-600 bg-slate-950 px-1 py-0.5 text-center font-mono text-[11px] text-slate-100 outline-none ring-accent/40 transition focus:ring"
                                    aria-label={`Drum key ${rowIndex + 1}`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => onDrummerSequencerRowRemove(track.id, row.id)}
                                    disabled={track.rows.length <= 1}
                                    className="rounded border border-slate-700 bg-slate-900 px-0.5 py-0.5 text-[9px] text-slate-300 transition hover:border-rose-400 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
                                    title={ui.remove}
                                    aria-label={`${ui.remove} drum key ${rowIndex + 1}`}
                                  >
                                    x
                                  </button>
                                </div>

                                {stepIndices.map((step) => {
                                  const cell = padRow?.steps[step] ?? { active: false, velocity: 127 };
                                  const isCurrentStep = track.enabled && sequencer.isPlaying && localPlayhead === step;
                                  const activeAlpha = 0.14 + (Math.max(0, Math.min(127, cell.velocity)) / 127) * 0.86;
                                  const ledDotStyle: CSSProperties | undefined = cell.active
                                    ? isCurrentStep
                                      ? {
                                          borderColor: "rgb(74 222 128)",
                                          backgroundColor: `rgba(74, 222, 128, ${activeAlpha})`,
                                          boxShadow: `0 0 ${4 + activeAlpha * 8}px rgba(74, 222, 128, ${0.35 + activeAlpha * 0.45})`
                                        }
                                      : {
                                          borderColor: "rgb(251 113 133)",
                                          backgroundColor: `rgba(251, 113, 133, ${activeAlpha})`,
                                          boxShadow: `0 0 ${3 + activeAlpha * 6}px rgba(251, 113, 133, ${0.25 + activeAlpha * 0.35})`
                                      }
                                    : undefined;
                                  const ledDotClass = cell.active
                                    ? isCurrentStep
                                      ? "h-3 w-3 rounded-full border animate-pulse"
                                      : "h-3 w-3 rounded-full border"
                                    : "h-3 w-3 rounded-full border border-slate-500 bg-slate-700";

                                  return (
                                    <button
                                      key={`${track.id}-drum-led-${row.id}-${step}`}
                                      type="button"
                                      onPointerDown={(event) =>
                                        handleDrummerLedPointerDown(
                                          event,
                                          track.id,
                                          row.id,
                                          step,
                                          cell.active,
                                          cell.velocity
                                        )
                                      }
                                      onPointerMove={handleDrummerLedPointerMove}
                                      onPointerUp={handleDrummerLedPointerEnd}
                                      onPointerCancel={cancelDrummerLedPointer}
                                      onKeyDown={(event) => {
                                        if (event.key === " " || event.key === "Enter") {
                                          event.preventDefault();
                                          onDrummerSequencerCellToggle(track.id, row.id, step);
                                        }
                                        if (event.key === "ArrowUp") {
                                          event.preventDefault();
                                          if (!cell.active) {
                                            onDrummerSequencerCellToggle(track.id, row.id, step, true);
                                          }
                                          onDrummerSequencerCellVelocityChange(
                                            track.id,
                                            row.id,
                                            step,
                                            Math.min(127, cell.velocity + 8)
                                          );
                                        }
                                        if (event.key === "ArrowDown") {
                                          event.preventDefault();
                                          if (!cell.active) {
                                            onDrummerSequencerCellToggle(track.id, row.id, step, true);
                                          }
                                          onDrummerSequencerCellVelocityChange(
                                            track.id,
                                            row.id,
                                            step,
                                            Math.max(0, cell.velocity - 8)
                                          );
                                        }
                                      }}
                                      className={`flex h-7 min-w-0 items-center justify-center rounded-md border transition ${
                                        isCurrentStep
                                          ? "border-emerald-500/60 bg-emerald-950/10"
                                          : "border-slate-700 bg-slate-900/35 hover:bg-slate-800/35"
                                      }`}
                                      aria-pressed={cell.active}
                                      aria-label={`Step ${step + 1}, drum key ${row.key}, velocity ${cell.velocity}`}
                                      title={`Step ${step + 1} | key ${row.key} | velocity ${cell.velocity} (drag up/down to change)`}
                                    >
                                      <span className={ledDotClass} style={ledDotStyle} aria-hidden="true" />
                                      <span className="sr-only">{cell.velocity}</span>
                                    </button>
                                  );
                                })}
                              </Fragment>
                            );
                          })}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}

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
                    <div className="mb-2 flex flex-wrap items-center gap-2">
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
                        onClick={() => onControllerSequencerClearSteps(controllerSequencer.id)}
                        className="rounded-md border border-slate-500/70 bg-slate-800/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400 hover:bg-slate-700"
                      >
                        {ui.clearSteps}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveControllerSequencer(controllerSequencer.id)}
                        disabled={!canRemovePerformDevice}
                        className="ml-auto rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
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

                      <PadLoopPatternEditor
                        ui={ui}
                        hostId={controllerSequencer.id}
                        track={controllerSequencer}
                        isPlaying={sequencer.isPlaying}
                        onPadLoopEnabledChange={(enabled) =>
                          onControllerSequencerPadLoopEnabledChange(controllerSequencer.id, enabled)
                        }
                        onPadLoopRepeatChange={(repeat) =>
                          onControllerSequencerPadLoopRepeatChange(controllerSequencer.id, repeat)
                        }
                        onPadLoopPatternChange={(pattern) =>
                          onControllerSequencerPadLoopPatternChange(controllerSequencer.id, pattern)
                        }
                      />
                    </div>

                    <div className="mb-2">
                      <div className="mb-1 text-xs uppercase tracking-[0.2em] text-slate-400">{ui.patternPads}</div>
                      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                        {Array.from({ length: 8 }, (_, padIndex) => {
                          const pad = controllerSequencer.pads[padIndex] ?? null;
                          const isActive = controllerSequencer.activePad === padIndex;
                          const isQueued = controllerSequencer.queuedPad === padIndex;
                          const padEndValue =
                            pad && pad.keypoints.length > 0 ? (pad.keypoints[pad.keypoints.length - 1]?.value ?? 0) : 0;
                          const padHasContent =
                            (pad?.keypoints.length ?? 0) > 2 ||
                            (pad?.keypoints[0]?.value ?? 0) !== 0 ||
                            padEndValue !== 0;
                          return (
                            <button
                              key={`${controllerSequencer.id}-pad-${padIndex}`}
                              type="button"
                              draggable
                              onClick={() => onControllerSequencerPadPress(controllerSequencer.id, padIndex)}
                              onDragStart={(event) => {
                                const payload = JSON.stringify({ trackId: controllerSequencer.id, padIndex });
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
                                if (
                                  !payload ||
                                  payload.trackId !== controllerSequencer.id ||
                                  payload.padIndex === padIndex
                                ) {
                                  return;
                                }
                                onControllerSequencerPadCopy(controllerSequencer.id, payload.padIndex, padIndex);
                              }}
                              className={`relative w-full rounded-md border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                                isActive
                                  ? "border-teal-300 bg-teal-400/20 text-teal-100"
                                  : isQueued
                                    ? "border-amber-400/70 bg-amber-400/10 text-amber-100"
                                    : "border-slate-700 bg-slate-900/50 text-slate-200 hover:bg-slate-800/55"
                              }`}
                              aria-pressed={isActive}
                              aria-label={`Controller pattern pad ${padIndex + 1}${isQueued ? " queued" : isActive ? " active" : ""}`}
                            >
                              P{padIndex + 1}
                              {padHasContent ? (
                                <span
                                  aria-hidden="true"
                                  className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-cyan-300"
                                />
                              ) : null}
                            </button>
                          );
                        })}
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
                    disabled={!canRemovePerformDevice}
                    className="ml-auto rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
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

                <div className="max-w-full">
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
                    disabled={!canRemovePerformDevice}
                    className="ml-auto rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
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

      {deletePerformanceDialogOpen ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
          onClick={closeDeletePerformanceDialog}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-performance-dialog-title"
            className="w-full max-w-md rounded-2xl border border-rose-500/35 bg-slate-900/95 p-4 shadow-[0_24px_80px_rgba(2,6,23,0.65)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-1 text-sm font-semibold uppercase tracking-[0.14em] text-rose-200">
              {ui.deletePerformanceDialogTitle}
            </div>
            <div
              id="delete-performance-dialog-title"
              className="mb-2 rounded-lg border border-slate-700 bg-slate-950/85 px-3 py-2 text-sm text-slate-100"
            >
              {deletePerformanceTargetName}
            </div>
            <p className="mb-4 text-xs text-slate-300">
              {ui.deletePerformanceDialogMessage(deletePerformanceTargetName)}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDeletePerformanceDialog}
                className="rounded-md border border-slate-500 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
              >
                {ui.cancel}
              </button>
              <button
                type="button"
                onClick={confirmDeletePerformance}
                className="rounded-md border border-rose-500/60 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25"
              >
                {ui.deletePerformance}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
