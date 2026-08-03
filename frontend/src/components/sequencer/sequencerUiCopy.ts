import type {
  ArpeggiatorPattern,
  ArpeggiatorRestartMode,
  ArpeggiatorVelocityMode,
  GuiLanguage,
  SequencerMode,
  SequencerScaleType
} from "../../types";

export type SequencerUiCopy = {
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
  exportCsdMidi: string;
  exportCsdScore: string;
  import: string;
  noInstrumentHint: string;
  patch: (index: number) => string;
  channel: string;
  effect: string;
  audioSources: string;
  noAudioSources: string;
  effectRouteLoop: string;
  remove: string;
  clearSteps: string;
  rackTransport: string;
  startInstruments: string;
  stopInstruments: string;
  startAll: string;
  stopAll: string;
  multitrackArrangerTitle: string;
  multitrackArrangerDeviceSummary: string;
  multitrackArrangerInstrumentColumn: string;
  multitrackArrangerTimelineColumn: string;
  multitrackArrangerSelectionRuler: string;
  multitrackArrangerSelectionHint: string;
  multitrackArrangerClearSelection: string;
  multitrackArrangerDragToken: string;
  multitrackArrangerTransportRewind: string;
  multitrackArrangerTransportStop: string;
  multitrackArrangerTransportPlay: string;
  multitrackArrangerTransportFastForward: string;
  multitrackArrangerContextMenuAddPad: string;
  multitrackArrangerContextMenuAddGroup: string;
  multitrackArrangerContextMenuAddSuperGroup: string;
  multitrackArrangerContextMenuCopy: string;
  multitrackArrangerContextMenuPaste: string;
  multitrackArrangerContextMenuGroup: string;
  multitrackArrangerContextMenuSuperGroup: string;
  multitrackArrangerContextMenuUngroup: string;
  multitrackArrangerContextMenuRemove: string;
  multitrackArrangerContextMenuNoGroups: string;
  multitrackArrangerContextMenuNoSuperGroups: string;
  multitrackArrangerContextMenuPasteDisabled: string;
  multitrackArrangerContextMenuInsertHint: string;
  zoomOut: string;
  zoomIn: string;
  sequencers: string;
  addSequencer: string;
  drummerSequencers: string;
  addDrummerSequencer: string;
  controllerSequencers: string;
  addControllerSequencer: string;
  arpeggiators: string;
  addArpeggiator: string;
  arpeggiatorWithIndex: (index: number) => string;
  inputChannel: string;
  targetChannel: string;
  preset: string;
  savePreset: string;
  presetNamePlaceholder: string;
  rate: string;
  gate: string;
  swing: string;
  octaves: string;
  pattern: string;
  latch: string;
  velocityMode: string;
  fixedVelocity: string;
  accentCycle: string;
  probability: string;
  repeats: string;
  humanizeMs: string;
  humanizeVelocity: string;
  transpose: string;
  scaleQuantize: string;
  restartMode: string;
  heldNotes: string;
  activeNote: string;
  arpeggiatorPatternLabels: Record<ArpeggiatorPattern, string>;
  arpeggiatorVelocityModeLabels: Record<ArpeggiatorVelocityMode, string>;
  arpeggiatorRestartModeLabels: Record<ArpeggiatorRestartMode, string>;
  globalSequencerClock: string;
  bpm: string;
  meter: string;
  grid: string;
  beatRate: string;
  beats: string;
  midiChannel: string;
  velocity: string;
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
  drummerSequencerWithIndex: (index: number) => string;
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
  dragVelocity: (value: number) => string;
  playhead: (playhead: number, stepCount: number) => string;
  cycle: (cycle: number) => string;
  midiInput: (name: string) => string;
  none: string;
  mixed: string;
  resetPlayhead: string;
  allNotesOff: string;
};

export const MODE_LABELS: Record<GuiLanguage, Record<SequencerMode, string>> = {
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

export const SCALE_TYPE_LABELS: Record<GuiLanguage, Record<SequencerScaleType, string>> = {
  english: { major: "major", neutral: "", minor: "minor" },
  german: { major: "dur", neutral: "", minor: "moll" },
  french: { major: "majeur", neutral: "", minor: "mineur" },
  spanish: { major: "mayor", neutral: "", minor: "menor" }
};

export const SEQUENCER_UI_COPY: Record<GuiLanguage, SequencerUiCopy> = {
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
    exportCsdMidi: "Export CSD (MIDI)",
    exportCsdScore: "Export CSD (SCORE)",
    import: "Import",
    noInstrumentHint: "Add at least one saved instrument to start the engine.",
    patch: (index) => `Patch ${index}`,
    channel: "Channel",
    effect: "Effect",
    audioSources: "Audio Sources",
    noAudioSources: "No audio sources",
    effectRouteLoop: "Would create an effect routing loop",
    remove: "Remove",
    clearSteps: "Clear Steps",
    rackTransport: "Rack Transport",
    startInstruments: "Start Instruments",
    stopInstruments: "Stop Instruments",
    startAll: "Start All",
    stopAll: "Stop All",
    multitrackArrangerTitle: "Multitrack Arranger",
    multitrackArrangerDeviceSummary: "1 device (auto)",
    multitrackArrangerInstrumentColumn: "Instrument",
    multitrackArrangerTimelineColumn: "Pattern Timeline (beat grid)",
    multitrackArrangerSelectionRuler: "Loop Range",
    multitrackArrangerSelectionHint: "Drag to select a loop range in beat-sized blocks, including 1 beat",
    multitrackArrangerClearSelection: "Click the highlighted range to clear the loop",
    multitrackArrangerDragToken: "Drag token",
    multitrackArrangerTransportRewind: "Rewind 1 beat",
    multitrackArrangerTransportStop: "Stop",
    multitrackArrangerTransportPlay: "Play",
    multitrackArrangerTransportFastForward: "Fast forward 1 beat",
    multitrackArrangerContextMenuAddPad: "Add pad",
    multitrackArrangerContextMenuAddGroup: "Add group",
    multitrackArrangerContextMenuAddSuperGroup: "Add super-group",
    multitrackArrangerContextMenuCopy: "Copy",
    multitrackArrangerContextMenuPaste: "Paste",
    multitrackArrangerContextMenuGroup: "Group",
    multitrackArrangerContextMenuSuperGroup: "Super-group",
    multitrackArrangerContextMenuUngroup: "Ungroup",
    multitrackArrangerContextMenuRemove: "Remove",
    multitrackArrangerContextMenuNoGroups: "No groups available",
    multitrackArrangerContextMenuNoSuperGroups: "No super-groups available",
    multitrackArrangerContextMenuPasteDisabled: "Copy pads/groups/super-groups first",
    multitrackArrangerContextMenuInsertHint: "Insert into a pause gap at the clicked beat, or append at the end.",
    zoomOut: "Zoom -",
    zoomIn: "Zoom +",
    sequencers: "Melodic Sequencers",
    addSequencer: "Add Melodic Sequencer",
    drummerSequencers: "Drummer Sequencers",
    addDrummerSequencer: "Add Drummer Sequencer",
    controllerSequencers: "Controller Sequencers",
    addControllerSequencer: "Add Controller Sequencer",
    arpeggiators: "Arpeggiators",
    addArpeggiator: "Add Arpeggiator",
    arpeggiatorWithIndex: (index) => `Arpeggiator ${index}`,
    inputChannel: "Input Channel",
    targetChannel: "Target Channel",
    preset: "Preset",
    savePreset: "Save Preset",
    presetNamePlaceholder: "Preset name",
    rate: "Rate",
    gate: "Gate",
    swing: "Swing",
    octaves: "Octaves",
    pattern: "Pattern",
    latch: "Latch",
    velocityMode: "Velocity Mode",
    fixedVelocity: "Fixed Velocity",
    accentCycle: "Accent Cycle",
    probability: "Probability",
    repeats: "Repeats",
    humanizeMs: "Humanize ms",
    humanizeVelocity: "Humanize Velocity",
    transpose: "Transpose",
    scaleQuantize: "Scale Quantize",
    restartMode: "Restart",
    heldNotes: "Held Notes",
    activeNote: "Active Note",
    arpeggiatorPatternLabels: {
      up: "Up",
      down: "Down",
      up_down: "Up/Down",
      down_up: "Down/Up",
      as_played: "As Played",
      random: "Random",
      chord: "Chord",
      inside_out: "Inside Out",
      outside_in: "Outside In"
    },
    arpeggiatorVelocityModeLabels: {
      input: "Input",
      fixed: "Fixed",
      accent: "Accent",
      random: "Random"
    },
    arpeggiatorRestartModeLabels: {
      free: "Free",
      first_note: "First Note"
    },
    globalSequencerClock: "Global Sequencer Clock",
    bpm: "BPM",
    meter: "Meter",
    grid: "Grid",
    beatRate: "Beat Ratio",
    beats: "Beats",
    midiChannel: "MIDI Channel",
    velocity: "Velocity",
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
    sequencerWithIndex: (index) => `Melodic Sequencer ${index}`,
    drummerSequencerWithIndex: (index) => `Drummer Sequencer ${index}`,
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
    dragVelocity: (value) => `velocity: ${value}`,
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
    exportCsdMidi: "CSD exportieren (MIDI)",
    exportCsdScore: "CSD exportieren (SCORE)",
    import: "Import",
    noInstrumentHint: "Fuege mindestens ein gespeichertes Instrument hinzu, um die Engine zu starten.",
    patch: (index) => `Patch ${index}`,
    channel: "Kanal",
    effect: "Effekt",
    audioSources: "Audio-Quellen",
    noAudioSources: "Keine Audio-Quellen",
    effectRouteLoop: "Wuerde eine Effekt-Routing-Schleife erzeugen",
    remove: "Entfernen",
    clearSteps: "Steps loeschen",
    rackTransport: "Rack-Transport",
    startInstruments: "Instrumente starten",
    stopInstruments: "Instrumente stoppen",
    startAll: "Alles starten",
    stopAll: "Alles stoppen",
    multitrackArrangerTitle: "Multitrack-Arranger",
    multitrackArrangerDeviceSummary: "1 Geraet (auto)",
    multitrackArrangerInstrumentColumn: "Instrument",
    multitrackArrangerTimelineColumn: "Pattern-Timeline (Beat-Raster)",
    multitrackArrangerSelectionRuler: "Loop-Bereich",
    multitrackArrangerSelectionHint: "Ziehen, um einen Loop-Bereich in Beat-Bloecken zu markieren, auch fuer 1 Beat",
    multitrackArrangerClearSelection: "Auf den markierten Bereich klicken, um den Loop zu loeschen",
    multitrackArrangerDragToken: "Token ziehen",
    multitrackArrangerTransportRewind: "1 Beat zurueckspulen",
    multitrackArrangerTransportStop: "Stopp",
    multitrackArrangerTransportPlay: "Abspielen",
    multitrackArrangerTransportFastForward: "1 Beat vorspulen",
    multitrackArrangerContextMenuAddPad: "Pad hinzufuegen",
    multitrackArrangerContextMenuAddGroup: "Gruppe hinzufuegen",
    multitrackArrangerContextMenuAddSuperGroup: "Super-Gruppe hinzufuegen",
    multitrackArrangerContextMenuCopy: "Kopieren",
    multitrackArrangerContextMenuPaste: "Einfuegen",
    multitrackArrangerContextMenuGroup: "Gruppe",
    multitrackArrangerContextMenuSuperGroup: "Super-Gruppe",
    multitrackArrangerContextMenuUngroup: "Aufloesen",
    multitrackArrangerContextMenuRemove: "Entfernen",
    multitrackArrangerContextMenuNoGroups: "Keine Gruppen verfuegbar",
    multitrackArrangerContextMenuNoSuperGroups: "Keine Super-Gruppen verfuegbar",
    multitrackArrangerContextMenuPasteDisabled: "Zuerst Pads/Gruppen/Super-Gruppen kopieren",
    multitrackArrangerContextMenuInsertHint:
      "In eine passende Pause an der angeklickten Beat-Position einfuegen oder am Ende anhaengen.",
    zoomOut: "Zoom -",
    zoomIn: "Zoom +",
    sequencers: "Melodische Sequencer",
    addSequencer: "Melodischen Sequencer hinzufuegen",
    drummerSequencers: "Drummer-Sequencer",
    addDrummerSequencer: "Drummer-Sequencer hinzufuegen",
    controllerSequencers: "Controller-Sequencer",
    addControllerSequencer: "Controller-Sequencer hinzufuegen",
    arpeggiators: "Arpeggiatoren",
    addArpeggiator: "Arpeggiator hinzufuegen",
    arpeggiatorWithIndex: (index) => `Arpeggiator ${index}`,
    inputChannel: "Eingangskanal",
    targetChannel: "Zielkanal",
    preset: "Preset",
    savePreset: "Preset speichern",
    presetNamePlaceholder: "Preset-Name",
    rate: "Rate",
    gate: "Gate",
    swing: "Swing",
    octaves: "Oktaven",
    pattern: "Pattern",
    latch: "Latch",
    velocityMode: "Velocity-Modus",
    fixedVelocity: "Feste Velocity",
    accentCycle: "Akzentfolge",
    probability: "Wahrscheinlichkeit",
    repeats: "Wiederholungen",
    humanizeMs: "Humanize ms",
    humanizeVelocity: "Humanize Velocity",
    transpose: "Transponieren",
    scaleQuantize: "Skalenquantisierung",
    restartMode: "Neustart",
    heldNotes: "Gehaltene Noten",
    activeNote: "Aktive Note",
    arpeggiatorPatternLabels: {
      up: "Auf",
      down: "Ab",
      up_down: "Auf/Ab",
      down_up: "Ab/Auf",
      as_played: "Gespielt",
      random: "Zufall",
      chord: "Akkord",
      inside_out: "Innen nach aussen",
      outside_in: "Aussen nach innen"
    },
    arpeggiatorVelocityModeLabels: {
      input: "Eingang",
      fixed: "Fest",
      accent: "Akzent",
      random: "Zufall"
    },
    arpeggiatorRestartModeLabels: {
      free: "Frei",
      first_note: "Erste Note"
    },
    globalSequencerClock: "Globale Sequencer-Clock",
    bpm: "BPM",
    meter: "Taktart",
    grid: "Raster",
    beatRate: "Beat-Verhaeltnis",
    beats: "Schlaege",
    midiChannel: "MIDI-Kanal",
    velocity: "Velocity",
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
    sequencerWithIndex: (index) => `Melodischer Sequencer ${index}`,
    drummerSequencerWithIndex: (index) => `Drummer-Sequencer ${index}`,
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
    dragVelocity: (value) => `velocity: ${value}`,
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
    exportCsdMidi: "Exporter CSD (MIDI)",
    exportCsdScore: "Exporter CSD (SCORE)",
    import: "Importer",
    noInstrumentHint: "Ajoutez au moins un instrument sauvegarde pour demarrer le moteur.",
    patch: (index) => `Patch ${index}`,
    channel: "Canal",
    effect: "Effet",
    audioSources: "Sources audio",
    noAudioSources: "Aucune source audio",
    effectRouteLoop: "Creerait une boucle de routage d'effet",
    remove: "Supprimer",
    clearSteps: "Effacer pas",
    rackTransport: "Transport du rack",
    startInstruments: "Demarrer instruments",
    stopInstruments: "Arreter instruments",
    startAll: "Tout demarrer",
    stopAll: "Tout arreter",
    multitrackArrangerTitle: "Arrangeur multipiste",
    multitrackArrangerDeviceSummary: "1 appareil (auto)",
    multitrackArrangerInstrumentColumn: "Instrument",
    multitrackArrangerTimelineColumn: "Timeline de pattern (grille temps)",
    multitrackArrangerSelectionRuler: "Plage de boucle",
    multitrackArrangerSelectionHint: "Glissez pour selectionner une plage de boucle en blocs d'un temps, meme pour 1 temps",
    multitrackArrangerClearSelection: "Cliquez sur la plage surlignee pour effacer la boucle",
    multitrackArrangerDragToken: "Glisser le token",
    multitrackArrangerTransportRewind: "Reculer d'un temps",
    multitrackArrangerTransportStop: "Arret",
    multitrackArrangerTransportPlay: "Lecture",
    multitrackArrangerTransportFastForward: "Avancer d'un temps",
    multitrackArrangerContextMenuAddPad: "Ajouter pad",
    multitrackArrangerContextMenuAddGroup: "Ajouter groupe",
    multitrackArrangerContextMenuAddSuperGroup: "Ajouter super-groupe",
    multitrackArrangerContextMenuCopy: "Copier",
    multitrackArrangerContextMenuPaste: "Coller",
    multitrackArrangerContextMenuGroup: "Groupe",
    multitrackArrangerContextMenuSuperGroup: "Super-groupe",
    multitrackArrangerContextMenuUngroup: "Degrouper",
    multitrackArrangerContextMenuRemove: "Supprimer",
    multitrackArrangerContextMenuNoGroups: "Aucun groupe disponible",
    multitrackArrangerContextMenuNoSuperGroups: "Aucun super-groupe disponible",
    multitrackArrangerContextMenuPasteDisabled: "Copier d'abord des pads/groupes/super-groupes",
    multitrackArrangerContextMenuInsertHint:
      "Inserer dans une pause assez grande au temps clique, sinon a la fin.",
    zoomOut: "Zoom -",
    zoomIn: "Zoom +",
    sequencers: "Sequenceurs melodiques",
    addSequencer: "Ajouter sequenceur melodique",
    drummerSequencers: "Sequenceurs batterie",
    addDrummerSequencer: "Ajouter sequenceur batterie",
    controllerSequencers: "Sequenceurs controleur",
    addControllerSequencer: "Ajouter sequenceur controleur",
    arpeggiators: "Arpegiateurs",
    addArpeggiator: "Ajouter arpegiateur",
    arpeggiatorWithIndex: (index) => `Arpegiateur ${index}`,
    inputChannel: "Canal entree",
    targetChannel: "Canal cible",
    preset: "Preset",
    savePreset: "Enregistrer preset",
    presetNamePlaceholder: "Nom du preset",
    rate: "Vitesse",
    gate: "Gate",
    swing: "Swing",
    octaves: "Octaves",
    pattern: "Pattern",
    latch: "Latch",
    velocityMode: "Mode velocite",
    fixedVelocity: "Velocite fixe",
    accentCycle: "Cycle accents",
    probability: "Probabilite",
    repeats: "Repetitions",
    humanizeMs: "Humanize ms",
    humanizeVelocity: "Humanize velocite",
    transpose: "Transposer",
    scaleQuantize: "Quantification gamme",
    restartMode: "Redemarrage",
    heldNotes: "Notes tenues",
    activeNote: "Note active",
    arpeggiatorPatternLabels: {
      up: "Montee",
      down: "Descente",
      up_down: "Montee/descente",
      down_up: "Descente/montee",
      as_played: "Joue",
      random: "Aleatoire",
      chord: "Accord",
      inside_out: "Interieur/exterieur",
      outside_in: "Exterieur/interieur"
    },
    arpeggiatorVelocityModeLabels: {
      input: "Entree",
      fixed: "Fixe",
      accent: "Accent",
      random: "Aleatoire"
    },
    arpeggiatorRestartModeLabels: {
      free: "Libre",
      first_note: "Premiere note"
    },
    globalSequencerClock: "Horloge globale du sequenceur",
    bpm: "BPM",
    meter: "Mesure",
    grid: "Grille",
    beatRate: "Ratio de temps",
    beats: "Temps",
    midiChannel: "Canal MIDI",
    velocity: "Velocite",
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
    sequencerWithIndex: (index) => `Sequenceur melodique ${index}`,
    drummerSequencerWithIndex: (index) => `Sequenceur batterie ${index}`,
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
    dragVelocity: (value) => `velocite: ${value}`,
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
    exportCsdMidi: "Exportar CSD (MIDI)",
    exportCsdScore: "Exportar CSD (SCORE)",
    import: "Importar",
    noInstrumentHint: "Agrega al menos un instrumento guardado para iniciar el motor.",
    patch: (index) => `Patch ${index}`,
    channel: "Canal",
    effect: "Efecto",
    audioSources: "Fuentes de audio",
    noAudioSources: "Sin fuentes de audio",
    effectRouteLoop: "Crearia un bucle de ruta de efecto",
    remove: "Eliminar",
    clearSteps: "Limpiar pasos",
    rackTransport: "Transporte del rack",
    startInstruments: "Iniciar instrumentos",
    stopInstruments: "Detener instrumentos",
    startAll: "Iniciar todo",
    stopAll: "Detener todo",
    multitrackArrangerTitle: "Arreglador multipista",
    multitrackArrangerDeviceSummary: "1 dispositivo (auto)",
    multitrackArrangerInstrumentColumn: "Instrumento",
    multitrackArrangerTimelineColumn: "Linea de patrones (rejilla por pulso)",
    multitrackArrangerSelectionRuler: "Rango de bucle",
    multitrackArrangerSelectionHint: "Arrastra para marcar un rango de bucle en bloques de un pulso, tambien de 1 pulso",
    multitrackArrangerClearSelection: "Haz clic en el rango resaltado para borrar el bucle",
    multitrackArrangerDragToken: "Arrastrar token",
    multitrackArrangerTransportRewind: "Retroceder 1 pulso",
    multitrackArrangerTransportStop: "Detener",
    multitrackArrangerTransportPlay: "Reproducir",
    multitrackArrangerTransportFastForward: "Avanzar 1 pulso",
    multitrackArrangerContextMenuAddPad: "Agregar pad",
    multitrackArrangerContextMenuAddGroup: "Agregar grupo",
    multitrackArrangerContextMenuAddSuperGroup: "Agregar supergrupo",
    multitrackArrangerContextMenuCopy: "Copiar",
    multitrackArrangerContextMenuPaste: "Pegar",
    multitrackArrangerContextMenuGroup: "Grupo",
    multitrackArrangerContextMenuSuperGroup: "Supergrupo",
    multitrackArrangerContextMenuUngroup: "Desagrupar",
    multitrackArrangerContextMenuRemove: "Eliminar",
    multitrackArrangerContextMenuNoGroups: "No hay grupos disponibles",
    multitrackArrangerContextMenuNoSuperGroups: "No hay supergrupos disponibles",
    multitrackArrangerContextMenuPasteDisabled: "Primero copia pads/grupos/supergrupos",
    multitrackArrangerContextMenuInsertHint:
      "Inserta en una pausa suficientemente grande en la posicion marcada o al final.",
    zoomOut: "Zoom -",
    zoomIn: "Zoom +",
    sequencers: "Secuenciadores melodicos",
    addSequencer: "Agregar secuenciador melodico",
    drummerSequencers: "Secuenciadores de bateria",
    addDrummerSequencer: "Agregar secuenciador de bateria",
    controllerSequencers: "Secuenciadores controladores",
    addControllerSequencer: "Agregar secuenciador controlador",
    arpeggiators: "Arpegiadores",
    addArpeggiator: "Agregar arpegiador",
    arpeggiatorWithIndex: (index) => `Arpegiador ${index}`,
    inputChannel: "Canal de entrada",
    targetChannel: "Canal destino",
    preset: "Preset",
    savePreset: "Guardar preset",
    presetNamePlaceholder: "Nombre del preset",
    rate: "Velocidad",
    gate: "Gate",
    swing: "Swing",
    octaves: "Octavas",
    pattern: "Patron",
    latch: "Latch",
    velocityMode: "Modo velocity",
    fixedVelocity: "Velocity fija",
    accentCycle: "Ciclo de acentos",
    probability: "Probabilidad",
    repeats: "Repeticiones",
    humanizeMs: "Humanize ms",
    humanizeVelocity: "Humanize velocity",
    transpose: "Transponer",
    scaleQuantize: "Cuantizar escala",
    restartMode: "Reinicio",
    heldNotes: "Notas retenidas",
    activeNote: "Nota activa",
    arpeggiatorPatternLabels: {
      up: "Arriba",
      down: "Abajo",
      up_down: "Arriba/abajo",
      down_up: "Abajo/arriba",
      as_played: "Como tocado",
      random: "Aleatorio",
      chord: "Acorde",
      inside_out: "Centro hacia fuera",
      outside_in: "Fuera hacia centro"
    },
    arpeggiatorVelocityModeLabels: {
      input: "Entrada",
      fixed: "Fija",
      accent: "Acento",
      random: "Aleatoria"
    },
    arpeggiatorRestartModeLabels: {
      free: "Libre",
      first_note: "Primera nota"
    },
    globalSequencerClock: "Reloj global del secuenciador",
    bpm: "BPM",
    meter: "Compas",
    grid: "Cuadricula",
    beatRate: "Relacion de pulso",
    beats: "Pulsos",
    midiChannel: "Canal MIDI",
    velocity: "Velocidad",
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
    sequencerWithIndex: (index) => `Secuenciador melodico ${index}`,
    drummerSequencerWithIndex: (index) => `Secuenciador de bateria ${index}`,
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
    dragVelocity: (value) => `velocidad: ${value}`,
    playhead: (playhead, stepCount) => `playhead: ${playhead + 1}/${stepCount}`,
    cycle: (cycle) => `ciclo: ${cycle}`,
    midiInput: (name) => `entrada midi: ${name}`,
    none: "ninguna",
    mixed: "mixto",
    resetPlayhead: "Reiniciar playhead",
    allNotesOff: "Todas las notas off"
  }
};

