import type { ImportDialogCopy } from "./importDialogs";
import type { GuiLanguage } from "../types";

export type AppCopy = {
  appIconAlt: string;
  appTitle: string;
  appDescription: string;
  guiLanguage: string;
  instrumentDesign: string;
  perform: string;
  config: string;
  graphEditor: string;
  graphStats: (nodes: number, connections: number) => string;
  selectedSummary: (nodes: number, connections: number) => string;
  showRuntime: string;
  showRuntimePanel: string;
  patchCompileStatusCompiled: string;
  patchCompileStatusPending: string;
  patchCompileStatusErrors: string;
  templateToken: string;
  newFromTemplateDialogTitle: string;
  newFromTemplateDialogDescription: string;
  templateSelectLabel: string;
  createFromTemplate: string;
  instrumentTabTitle: (index: number) => string;
  confirmDeleteSelection: (count: number) => string;
  deleteSelectionDialogListLabel: string;
  deleteSelectionDialogOpcodeItem: (opcodeName: string, nodeId: string) => string;
  deleteSelectionDialogConnectionItem: (from: string, to: string) => string;
  deletePatchDialogListLabel: string;
  deletePatchDialogPatchItem: (name: string) => string;
  deletePatchDialogIdItem: (patchId: string) => string;
  deletePatchDialogGraphItem: (nodes: number, connections: number) => string;
  cancel: string;
  deleteAction: string;
  confirmDeletePatch: string;
  confirmDeletePerformance: string;
  errors: {
    noActiveRuntimeSession: string;
    startInstrumentsFirstForSequencer: string;
    noActiveInstrumentSessionForSequencer: string;
    failedToStartSequencer: string;
    failedToStopInstrumentEngine: string;
    startInstrumentsBeforePianoRoll: string;
    noActiveInstrumentSession: string;
    failedToStartPianoRollNote: string;
    failedToSendMidiControllerValue: string;
    failedToSaveSequencerConfig: string;
    failedToExportPerformanceCsd: string;
    failedToLoadSequencerConfig: string;
    failedToInitializeMidiControllers: string;
    failedToSyncSequencerStatus: string;
    failedToUpdateSequencerConfig: string;
    tooManySequencerTracks: (count: number, maximum: number) => string;
    sessionNotRunningSequencerStopped: string;
    noActiveSessionForPadSwitching: string;
    failedToQueuePad: string;
  };
};

export const GUI_LANGUAGE_SHORT_LABELS: Record<GuiLanguage, string> = {
  english: "EN",
  german: "DE",
  french: "FR",
  spanish: "ES"
};

export const APP_COPY: Record<GuiLanguage, AppCopy> = {
  english: {
    appIconAlt: "Orchestron icon",
    appTitle: "Orchestron",
    appDescription: "Visual opcode patching with realtime CSound sessions and macOS MIDI loopback support.",
    guiLanguage: "GUI Language",
    instrumentDesign: "Instrument Design",
    perform: "Perform",
    config: "Config",
    graphEditor: "Graph Editor",
    graphStats: (nodes, connections) => `Graph Editor (${nodes} nodes, ${connections} connections)`,
    selectedSummary: (nodes, connections) => `Selected: ${nodes} opcode(s), ${connections} connection(s)`,
    showRuntime: "Show Runtime",
    showRuntimePanel: "Show runtime panel",
    patchCompileStatusCompiled: "(compiled)",
    patchCompileStatusPending: "(pending changes)",
    patchCompileStatusErrors: "(errors)",
    templateToken: "TEMPLATE",
    newFromTemplateDialogTitle: "New from template",
    newFromTemplateDialogDescription: "Choose a saved template to seed a new instrument draft.",
    templateSelectLabel: "Template",
    createFromTemplate: "Create",
    instrumentTabTitle: (index) => `Instrument ${index}`,
    confirmDeleteSelection: (count) => `Delete ${count} elements?`,
    deleteSelectionDialogListLabel: "The following elements will be deleted:",
    deleteSelectionDialogOpcodeItem: (opcodeName, nodeId) => `Opcode: ${opcodeName} (${nodeId})`,
    deleteSelectionDialogConnectionItem: (from, to) => `Connection: ${from} -> ${to}`,
    deletePatchDialogListLabel: "The following saved patch will be deleted:",
    deletePatchDialogPatchItem: (name) => `Patch: ${name}`,
    deletePatchDialogIdItem: (patchId) => `ID: ${patchId}`,
    deletePatchDialogGraphItem: (nodes, connections) => `Graph: ${nodes} opcode(s), ${connections} connection(s)`,
    cancel: "Cancel",
    deleteAction: "Delete",
    confirmDeletePatch: "do you really want to delete this patch?",
    confirmDeletePerformance: "do you really want to delete this performance?",
    errors: {
      noActiveRuntimeSession: "No active runtime session available.",
      startInstrumentsFirstForSequencer:
        "Start instruments first. Sequencer transport is independent from instrument engine start/stop.",
      noActiveInstrumentSessionForSequencer: "No active instrument session available. Start instruments first.",
      failedToStartSequencer: "Failed to start sequencer.",
      failedToStopInstrumentEngine: "Failed to stop instrument engine.",
      startInstrumentsBeforePianoRoll: "The piano roll needs the instrument engine running before notes can sound.",
      noActiveInstrumentSession: "No active instrument session available.",
      failedToStartPianoRollNote: "Failed to start piano roll note.",
      failedToSendMidiControllerValue: "Failed to send MIDI controller value.",
      failedToSaveSequencerConfig: "Failed to save sequencer config.",
      failedToExportPerformanceCsd: "Failed to export performance CSD bundle.",
      failedToLoadSequencerConfig: "Failed to load sequencer config.",
      failedToInitializeMidiControllers: "Failed to initialize MIDI controllers.",
      failedToSyncSequencerStatus: "Failed to sync sequencer status.",
      failedToUpdateSequencerConfig: "Failed to update sequencer config.",
      tooManySequencerTracks: (count, maximum) =>
        `This performance creates ${count} backend note tracks; the supported maximum is ${maximum}. Reduce melodic sequencers or drummer rows.`,
      sessionNotRunningSequencerStopped: "Session is no longer running. Sequencer transport stopped.",
      noActiveSessionForPadSwitching: "No active session available for pad switching.",
      failedToQueuePad: "Failed to queue pad."
    }
  },
  german: {
    appIconAlt: "Orchestron-Icon",
    appTitle: "Orchestron",
    appDescription: "Visuelles Opcode-Patching mit Echtzeit-CSound-Sessions und macOS-MIDI-Loopback-Unterstuetzung.",
    guiLanguage: "GUI-Sprache",
    instrumentDesign: "Instrument-Design",
    perform: "Performance",
    config: "Konfig",
    graphEditor: "Graph-Editor",
    graphStats: (nodes, connections) => `Graph-Editor (${nodes} Nodes, ${connections} Verbindungen)`,
    selectedSummary: (nodes, connections) => `Ausgewaehlt: ${nodes} Opcode(s), ${connections} Verbindung(en)`,
    showRuntime: "Runtime anzeigen",
    showRuntimePanel: "Runtime-Panel anzeigen",
    patchCompileStatusCompiled: "(kompiliert)",
    patchCompileStatusPending: "(aenderungen offen)",
    patchCompileStatusErrors: "(fehler)",
    templateToken: "TEMPLATE",
    newFromTemplateDialogTitle: "Neu aus Template",
    newFromTemplateDialogDescription: "Waehle ein gespeichertes Template als Basis fuer einen neuen Instrument-Entwurf.",
    templateSelectLabel: "Template",
    createFromTemplate: "Erstellen",
    instrumentTabTitle: (index) => `Instrument ${index}`,
    confirmDeleteSelection: (count) => `${count} Elemente loeschen?`,
    deleteSelectionDialogListLabel: "Die folgenden Elemente werden geloescht:",
    deleteSelectionDialogOpcodeItem: (opcodeName, nodeId) => `Opcode: ${opcodeName} (${nodeId})`,
    deleteSelectionDialogConnectionItem: (from, to) => `Verbindung: ${from} -> ${to}`,
    deletePatchDialogListLabel: "Das folgende gespeicherte Patch wird geloescht:",
    deletePatchDialogPatchItem: (name) => `Patch: ${name}`,
    deletePatchDialogIdItem: (patchId) => `ID: ${patchId}`,
    deletePatchDialogGraphItem: (nodes, connections) => `Graph: ${nodes} Opcode(s), ${connections} Verbindung(en)`,
    cancel: "Abbrechen",
    deleteAction: "Loeschen",
    confirmDeletePatch: "Willst du dieses Patch wirklich loeschen?",
    confirmDeletePerformance: "Willst du diese Performance wirklich loeschen?",
    errors: {
      noActiveRuntimeSession: "Keine aktive Runtime-Session verfuegbar.",
      startInstrumentsFirstForSequencer:
        "Starte zuerst Instrumente. Der Sequencer-Transport ist vom Start/Stop der Engine getrennt.",
      noActiveInstrumentSessionForSequencer: "Keine aktive Instrument-Session verfuegbar. Bitte zuerst starten.",
      failedToStartSequencer: "Sequencer konnte nicht gestartet werden.",
      failedToStopInstrumentEngine: "Instrument-Engine konnte nicht gestoppt werden.",
      startInstrumentsBeforePianoRoll: "Die Piano Roll benoetigt eine laufende Instrument-Engine, bevor Noten klingen koennen.",
      noActiveInstrumentSession: "Keine aktive Instrument-Session verfuegbar.",
      failedToStartPianoRollNote: "Piano-Roll-Note konnte nicht gestartet werden.",
      failedToSendMidiControllerValue: "MIDI-Controller-Wert konnte nicht gesendet werden.",
      failedToSaveSequencerConfig: "Sequencer-Konfiguration konnte nicht gespeichert werden.",
      failedToExportPerformanceCsd: "Performance-CSD-Bundle konnte nicht exportiert werden.",
      failedToLoadSequencerConfig: "Sequencer-Konfiguration konnte nicht geladen werden.",
      failedToInitializeMidiControllers: "MIDI-Controller konnten nicht initialisiert werden.",
      failedToSyncSequencerStatus: "Sequencer-Status konnte nicht synchronisiert werden.",
      failedToUpdateSequencerConfig: "Sequencer-Konfiguration konnte nicht aktualisiert werden.",
      tooManySequencerTracks: (count, maximum) =>
        `Diese Performance erzeugt ${count} Backend-Notenspuren; maximal ${maximum} werden unterstuetzt. Melodische Sequencer oder Drum-Zeilen reduzieren.`,
      sessionNotRunningSequencerStopped: "Session laeuft nicht mehr. Sequencer-Transport wurde gestoppt.",
      noActiveSessionForPadSwitching: "Keine aktive Session fuer Pad-Wechsel verfuegbar.",
      failedToQueuePad: "Pad konnte nicht in die Warteschlange gesetzt werden."
    }
  },
  french: {
    appIconAlt: "Icone Orchestron",
    appTitle: "Orchestron",
    appDescription:
      "Patching visuel d'opcodes avec sessions CSound temps reel et support loopback MIDI macOS.",
    guiLanguage: "Langue GUI",
    instrumentDesign: "Design instrument",
    perform: "Performance",
    config: "Config",
    graphEditor: "Editeur de graphe",
    graphStats: (nodes, connections) => `Editeur de graphe (${nodes} noeuds, ${connections} connexions)`,
    selectedSummary: (nodes, connections) => `Selection: ${nodes} opcode(s), ${connections} connexion(s)`,
    showRuntime: "Afficher runtime",
    showRuntimePanel: "Afficher panneau runtime",
    patchCompileStatusCompiled: "(compile)",
    patchCompileStatusPending: "(modifications en attente)",
    patchCompileStatusErrors: "(erreurs)",
    templateToken: "TEMPLATE",
    newFromTemplateDialogTitle: "Nouveau depuis template",
    newFromTemplateDialogDescription: "Choisissez un template enregistre comme base pour un nouveau brouillon.",
    templateSelectLabel: "Template",
    createFromTemplate: "Creer",
    instrumentTabTitle: (index) => `Instrument ${index}`,
    confirmDeleteSelection: (count) => `Supprimer ${count} elements ?`,
    deleteSelectionDialogListLabel: "Les elements suivants seront supprimes :",
    deleteSelectionDialogOpcodeItem: (opcodeName, nodeId) => `Opcode : ${opcodeName} (${nodeId})`,
    deleteSelectionDialogConnectionItem: (from, to) => `Connexion : ${from} -> ${to}`,
    deletePatchDialogListLabel: "Le patch enregistre suivant sera supprime :",
    deletePatchDialogPatchItem: (name) => `Patch : ${name}`,
    deletePatchDialogIdItem: (patchId) => `ID : ${patchId}`,
    deletePatchDialogGraphItem: (nodes, connections) => `Graphe : ${nodes} opcode(s), ${connections} connexion(s)`,
    cancel: "Annuler",
    deleteAction: "Supprimer",
    confirmDeletePatch: "Voulez-vous vraiment supprimer ce patch ?",
    confirmDeletePerformance: "Voulez-vous vraiment supprimer cette performance ?",
    errors: {
      noActiveRuntimeSession: "Aucune session runtime active disponible.",
      startInstrumentsFirstForSequencer:
        "Demarrez d'abord les instruments. Le transport sequencer est independant du start/stop moteur.",
      noActiveInstrumentSessionForSequencer:
        "Aucune session instrument active disponible. Demarrez d'abord les instruments.",
      failedToStartSequencer: "Echec du demarrage du sequencer.",
      failedToStopInstrumentEngine: "Echec de l'arret du moteur instrument.",
      startInstrumentsBeforePianoRoll:
        "Le piano roll a besoin du moteur instrument actif avant que les notes puissent sonner.",
      noActiveInstrumentSession: "Aucune session instrument active disponible.",
      failedToStartPianoRollNote: "Echec du demarrage de la note piano roll.",
      failedToSendMidiControllerValue: "Echec de l'envoi de la valeur du controleur MIDI.",
      failedToSaveSequencerConfig: "Echec de l'enregistrement de la configuration sequencer.",
      failedToExportPerformanceCsd: "Echec de l'export du bundle CSD de performance.",
      failedToLoadSequencerConfig: "Echec du chargement de la configuration sequencer.",
      failedToInitializeMidiControllers: "Echec de l'initialisation des controleurs MIDI.",
      failedToSyncSequencerStatus: "Echec de synchronisation du statut sequencer.",
      failedToUpdateSequencerConfig: "Echec de mise a jour de la configuration sequencer.",
      tooManySequencerTracks: (count, maximum) =>
        `Cette performance cree ${count} pistes de notes backend ; le maximum pris en charge est ${maximum}. Reduisez les sequenceurs melodiques ou les lignes de batterie.`,
      sessionNotRunningSequencerStopped: "La session ne tourne plus. Le transport sequencer est arrete.",
      noActiveSessionForPadSwitching: "Aucune session active pour le changement de pad.",
      failedToQueuePad: "Echec de mise en file du pad."
    }
  },
  spanish: {
    appIconAlt: "Icono de Orchestron",
    appTitle: "Orchestron",
    appDescription:
      "Patching visual de opcodes con sesiones CSound en tiempo real y soporte de loopback MIDI en macOS.",
    guiLanguage: "Idioma de GUI",
    instrumentDesign: "Diseno de instrumento",
    perform: "Performance",
    config: "Config",
    graphEditor: "Editor de grafos",
    graphStats: (nodes, connections) => `Editor de grafos (${nodes} nodos, ${connections} conexiones)`,
    selectedSummary: (nodes, connections) => `Seleccionado: ${nodes} opcode(s), ${connections} conexion(es)`,
    showRuntime: "Mostrar runtime",
    showRuntimePanel: "Mostrar panel runtime",
    patchCompileStatusCompiled: "(compilado)",
    patchCompileStatusPending: "(cambios pendientes)",
    patchCompileStatusErrors: "(errores)",
    templateToken: "TEMPLATE",
    newFromTemplateDialogTitle: "Nuevo desde template",
    newFromTemplateDialogDescription: "Elige un template guardado como base para un nuevo borrador de instrumento.",
    templateSelectLabel: "Template",
    createFromTemplate: "Crear",
    instrumentTabTitle: (index) => `Instrumento ${index}`,
    confirmDeleteSelection: (count) => `Eliminar ${count} elementos?`,
    deleteSelectionDialogListLabel: "Se eliminaran los siguientes elementos:",
    deleteSelectionDialogOpcodeItem: (opcodeName, nodeId) => `Opcode: ${opcodeName} (${nodeId})`,
    deleteSelectionDialogConnectionItem: (from, to) => `Conexion: ${from} -> ${to}`,
    deletePatchDialogListLabel: "Se eliminara el siguiente patch guardado:",
    deletePatchDialogPatchItem: (name) => `Patch: ${name}`,
    deletePatchDialogIdItem: (patchId) => `ID: ${patchId}`,
    deletePatchDialogGraphItem: (nodes, connections) => `Grafo: ${nodes} opcode(s), ${connections} conexion(es)`,
    cancel: "Cancelar",
    deleteAction: "Eliminar",
    confirmDeletePatch: "Deseas eliminar este patch?",
    confirmDeletePerformance: "Deseas eliminar esta performance?",
    errors: {
      noActiveRuntimeSession: "No hay una sesion runtime activa disponible.",
      startInstrumentsFirstForSequencer:
        "Inicia primero los instrumentos. El transporte del secuenciador es independiente del start/stop del motor.",
      noActiveInstrumentSessionForSequencer:
        "No hay una sesion de instrumentos activa. Inicia primero los instrumentos.",
      failedToStartSequencer: "No se pudo iniciar el secuenciador.",
      failedToStopInstrumentEngine: "No se pudo detener el motor de instrumentos.",
      startInstrumentsBeforePianoRoll:
        "El piano roll necesita el motor de instrumentos en marcha antes de que las notas suenen.",
      noActiveInstrumentSession: "No hay una sesion de instrumentos activa.",
      failedToStartPianoRollNote: "No se pudo iniciar la nota del piano roll.",
      failedToSendMidiControllerValue: "No se pudo enviar el valor del controlador MIDI.",
      failedToSaveSequencerConfig: "No se pudo guardar la configuracion del secuenciador.",
      failedToExportPerformanceCsd: "No se pudo exportar el bundle CSD de la performance.",
      failedToLoadSequencerConfig: "No se pudo cargar la configuracion del secuenciador.",
      failedToInitializeMidiControllers: "No se pudieron inicializar los controladores MIDI.",
      failedToSyncSequencerStatus: "No se pudo sincronizar el estado del secuenciador.",
      failedToUpdateSequencerConfig: "No se pudo actualizar la configuracion del secuenciador.",
      tooManySequencerTracks: (count, maximum) =>
        `Esta performance crea ${count} pistas de notas backend; el maximo admitido es ${maximum}. Reduce los secuenciadores melodicos o las filas de bateria.`,
      sessionNotRunningSequencerStopped: "La sesion ya no esta en ejecucion. El transporte del secuenciador se detuvo.",
      noActiveSessionForPadSwitching: "No hay una sesion activa para cambiar pads.",
      failedToQueuePad: "No se pudo poner en cola el pad."
    }
  }
};

export const IMPORT_DIALOG_COPY: Record<GuiLanguage, ImportDialogCopy> = {
  english: {
    optionsTitle: "Import Options",
    optionsDescription: "Choose what should be imported from this file.",
    performanceLabel: "performance",
    patchDefinitionsLabel: "patch definitions",
    conflictsTitle: "Name Conflicts",
    conflictsDescription:
      "Existing items were found. Keep overwrite checked to replace existing entries. Uncheck overwrite to import under a new name. Enable skip to ignore a patch definition.",
    overwriteLabel: "overwrite",
    skipLabel: "skip",
    newNameLabel: "New Name",
    cancel: "Cancel",
    import: "Import",
    conflictPatchLabel: (name) => `Instrument patch: ${name}`,
    conflictPerformanceLabel: (name) => `Performance: ${name}`,
    validation: {
      nameRequired: (kindLabel, originalName) => `A new name is required for ${kindLabel} "${originalName}".`,
      patchNameExists: (name) => `Instrument patch name "${name}" already exists.`,
      patchNameDuplicate: (name) => `Instrument patch name "${name}" is used more than once in this import.`,
      performanceNameExists: (name) => `Performance name "${name}" already exists.`,
      performanceNameDuplicate: (name) => `Performance name "${name}" is used more than once in this import.`
    }
  },
  german: {
    optionsTitle: "Importoptionen",
    optionsDescription: "Wähle aus, was aus dieser Datei importiert werden soll.",
    performanceLabel: "performance",
    patchDefinitionsLabel: "patch-definitionen",
    conflictsTitle: "Namenskonflikte",
    conflictsDescription:
      "Es wurden bestehende Einträge gefunden. Lass Überschreiben aktiviert, um bestehende Einträge zu ersetzen. Deaktiviere Überschreiben für einen neuen Namen. Aktiviere Überspringen, um eine Patch-Definition zu ignorieren.",
    overwriteLabel: "überschreiben",
    skipLabel: "überspringen",
    newNameLabel: "Neuer Name",
    cancel: "Abbrechen",
    import: "Importieren",
    conflictPatchLabel: (name) => `Instrument-Patch: ${name}`,
    conflictPerformanceLabel: (name) => `Performance: ${name}`,
    validation: {
      nameRequired: (kindLabel, originalName) =>
        `Ein neuer Name ist erforderlich für ${kindLabel} "${originalName}".`,
      patchNameExists: (name) => `Instrument-Patch-Name "${name}" existiert bereits.`,
      patchNameDuplicate: (name) =>
        `Instrument-Patch-Name "${name}" wird in diesem Import mehr als einmal verwendet.`,
      performanceNameExists: (name) => `Performance-Name "${name}" existiert bereits.`,
      performanceNameDuplicate: (name) =>
        `Performance-Name "${name}" wird in diesem Import mehr als einmal verwendet.`
    }
  },
  french: {
    optionsTitle: "Options d'importation",
    optionsDescription: "Choisissez ce qui doit être importé depuis ce fichier.",
    performanceLabel: "performance",
    patchDefinitionsLabel: "définitions de patch",
    conflictsTitle: "Conflits de noms",
    conflictsDescription:
      "Des éléments existants ont été trouvés. Laissez Écraser activé pour remplacer les éléments existants. Désactivez Écraser pour importer avec un nouveau nom. Activez Ignorer pour ne pas importer une définition de patch.",
    overwriteLabel: "écraser",
    skipLabel: "ignorer",
    newNameLabel: "Nouveau nom",
    cancel: "Annuler",
    import: "Importer",
    conflictPatchLabel: (name) => `Patch d'instrument : ${name}`,
    conflictPerformanceLabel: (name) => `Performance : ${name}`,
    validation: {
      nameRequired: (kindLabel, originalName) => `Un nouveau nom est requis pour ${kindLabel} "${originalName}".`,
      patchNameExists: (name) => `Le nom de patch d'instrument "${name}" existe déjà.`,
      patchNameDuplicate: (name) =>
        `Le nom de patch d'instrument "${name}" est utilisé plusieurs fois dans cet import.`,
      performanceNameExists: (name) => `Le nom de performance "${name}" existe déjà.`,
      performanceNameDuplicate: (name) => `Le nom de performance "${name}" est utilisé plusieurs fois dans cet import.`
    }
  },
  spanish: {
    optionsTitle: "Opciones de importación",
    optionsDescription: "Elige qué debe importarse desde este archivo.",
    performanceLabel: "performance",
    patchDefinitionsLabel: "definiciones de patch",
    conflictsTitle: "Conflictos de nombre",
    conflictsDescription:
      "Se encontraron elementos existentes. Deja Sobrescribir activado para reemplazar elementos existentes. Desactiva Sobrescribir para importar con un nombre nuevo. Activa Omitir para ignorar una definición de patch.",
    overwriteLabel: "sobrescribir",
    skipLabel: "omitir",
    newNameLabel: "Nuevo nombre",
    cancel: "Cancelar",
    import: "Importar",
    conflictPatchLabel: (name) => `Patch de instrumento: ${name}`,
    conflictPerformanceLabel: (name) => `Performance: ${name}`,
    validation: {
      nameRequired: (kindLabel, originalName) => `Se requiere un nombre nuevo para ${kindLabel} "${originalName}".`,
      patchNameExists: (name) => `El nombre de patch de instrumento "${name}" ya existe.`,
      patchNameDuplicate: (name) =>
        `El nombre de patch de instrumento "${name}" se usa más de una vez en esta importación.`,
      performanceNameExists: (name) => `El nombre de performance "${name}" ya existe.`,
      performanceNameDuplicate: (name) =>
        `El nombre de performance "${name}" se usa más de una vez en esta importación.`
    }
  }
};
