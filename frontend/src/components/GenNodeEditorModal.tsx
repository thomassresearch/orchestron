import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import {
  GEN_ROUTINE_OPTIONS,
  buildGenNodePreview,
  genRoutineKindForNumber,
  normalizeGenNodeConfig,
  type GenAudioAssetRef,
  type GenNodeConfig
} from "../lib/genNodeConfig";
import type { GuiLanguage } from "../types";

type GenEditorCopy = {
  title: string;
  nodeLabel: string;
  close: string;
  tableGenerationMode: string;
  opcode: string;
  genRoutine: string;
  routineNumber: string;
  tableNumber: string;
  tableSize: string;
  startTime: string;
  normalizeTable: string;
  customRoutineNoteBeforeExpr: string;
  customRoutineNoteExprPrefix: string;
  customRoutineNoteAfterExpr: string;
  routineParameters: string;
  add: string;
  deleteShort: string;
  keepAtLeastOneEntry: string;
  removeRow: string;
  harmonicAmplitudes: string;
  valueList: string;
  startValue: string;
  segmentsLengthValue: string;
  nh: string;
  lh: string;
  rMultiplier: string;
  gen17Hint: string;
  xyPairs: string;
  windowType: string;
  max: string;
  opt: string;
  gen20NoOpt: string;
  uploadAudioFile: string;
  uploading: string;
  clearAsset: string;
  persistedAsset: string;
  fallbackSamplePath: string;
  skipTime: string;
  format: string;
  channel: string;
  rawArguments: string;
  rawArgsHelpBeforeExpr: string;
  rawArgsHelpExprPrefix: string;
  rawArgsHelpAfterExpr: string;
  preview: string;
  effectiveGen: string;
  flattenedArgs: string;
  renderedLine: string;
  none: string;
  notes: string;
  gen01Note: string;
  ftgenonceNote: string;
  cancel: string;
  saveGen: string;
  customRoutineOption: (routineNumber: number) => string;
  configureGenNodeAria: (nodeId: string) => string;
  routineLabels: Partial<Record<number, string>>;
  routineDescriptions: Partial<Record<number, string>>;
  gen20WindowLabels: Record<number, string>;
  customWindowOption: (value: number) => string;
};

const GEN_EDITOR_COPY: Record<GuiLanguage, GenEditorCopy> = {
  english: {
    title: "GEN Editor",
    nodeLabel: "Node",
    close: "Close",
    tableGenerationMode: "Table Generation Mode",
    opcode: "Opcode",
    genRoutine: "GEN Routine",
    routineNumber: "Routine Number",
    tableNumber: "Table Number",
    tableSize: "Table Size",
    startTime: "Start Time",
    normalizeTable: "Normalize table (use positive GEN number)",
    customRoutineNoteBeforeExpr:
      "Custom GEN routine. Use the raw arguments editor below. For string literals, wrap values in quotes. Use",
    customRoutineNoteExprPrefix: "expr:",
    customRoutineNoteAfterExpr: "to force an unquoted expression.",
    routineParameters: "Routine Parameters",
    add: "Add",
    deleteShort: "Del",
    keepAtLeastOneEntry: "Keep at least one entry",
    removeRow: "Remove row",
    harmonicAmplitudes: "Harmonic Amplitudes",
    valueList: "Value List",
    startValue: "Start Value",
    segmentsLengthValue: "Segments (length, value)",
    nh: "nh (harmonics)",
    lh: "lh (lowest harmonic)",
    rMultiplier: "r (multiplier)",
    gen17Hint: "Enter ascending x/y pairs. GEN17 commonly uses negative generator mode (disable normalization) for raw mappings.",
    xyPairs: "x/y Pairs",
    windowType: "Window Type",
    max: "max",
    opt: "opt",
    gen20NoOpt: "This window type does not use the optional GEN20 parameter.",
    uploadAudioFile: "Upload Audio File",
    uploading: "Uploading...",
    clearAsset: "Clear Asset",
    persistedAsset: "Persisted asset",
    fallbackSamplePath: "Fallback Sample Path (optional)",
    skipTime: "Skip Time",
    format: "Format",
    channel: "Channel",
    rawArguments: "Raw Arguments",
    rawArgsHelpBeforeExpr: "Use commas or new lines. Strings should be quoted. Prefix with",
    rawArgsHelpExprPrefix: "expr:",
    rawArgsHelpAfterExpr: "to emit an unquoted expression.",
    preview: "Preview",
    effectiveGen: "Effective GEN",
    flattenedArgs: "Flattened Args",
    renderedLine: "Rendered Line",
    none: "(none)",
    notes: "Notes",
    gen01Note: "GEN01 uses the uploaded asset if present. The backend compiler resolves it to the stored file path.",
    ftgenonceNote: "`ftgenonce` ignores Start Time and uses the same table parameter as the `ftgenonce` first argument.",
    cancel: "Cancel",
    saveGen: "Save GEN",
    customRoutineOption: (routineNumber) => `Custom GEN${routineNumber}`,
    configureGenNodeAria: (nodeId) => `GEN editor for ${nodeId}`,
    routineLabels: {
      1: "GEN01 - Audio File",
      2: "GEN02 - Value List",
      7: "GEN07 - Segments",
      10: "GEN10 - Harmonic Sine Partials",
      11: "GEN11 - Harmonic Cosine Partials",
      17: "GEN17 - Step Table From x/y Pairs",
      20: "GEN20 - Window / Distribution Function"
    },
    routineDescriptions: {
      1: "Load a sound file into a function table (uploaded asset or custom path).",
      2: "Enter literal values copied into the table.",
      7: "Define a start value and line segments using length/value pairs.",
      10: "Enter harmonic amplitudes (1st, 2nd, 3rd partial, ...).",
      11: "Specify number of harmonics, lowest harmonic, and harmonic multiplier.",
      17: "Specify x/y point pairs for stepped lookup mappings (often used unnormalized).",
      20: "Generate a window or distribution by window type, max value, and optional parameter."
    },
    gen20WindowLabels: {
      1: "Hamming",
      2: "Hanning",
      3: "Bartlett (triangle)",
      4: "Blackman (3-term)",
      5: "Blackman-Harris (4-term)",
      6: "Gaussian",
      7: "Kaiser",
      8: "Rectangle",
      9: "Sinc"
    },
    customWindowOption: (value) => `Custom ${value}`
  },
  german: {
    title: "GEN-Editor",
    nodeLabel: "Node",
    close: "Schliessen",
    tableGenerationMode: "Tabellengenerierung",
    opcode: "Opcode",
    genRoutine: "GEN-Routine",
    routineNumber: "Routinennummer",
    tableNumber: "Tabellennummer",
    tableSize: "Tabellengroesse",
    startTime: "Startzeit",
    normalizeTable: "Tabelle normalisieren (positive GEN-Nummer verwenden)",
    customRoutineNoteBeforeExpr:
      "Benutzerdefinierte GEN-Routine. Verwende unten den Raw-Argument-Editor. String-Literale in Anfuehrungszeichen setzen. Mit",
    customRoutineNoteExprPrefix: "expr:",
    customRoutineNoteAfterExpr: "einen unquotierten Ausdruck erzwingen.",
    routineParameters: "Routinenparameter",
    add: "Hinzufuegen",
    deleteShort: "Del",
    keepAtLeastOneEntry: "Mindestens einen Eintrag behalten",
    removeRow: "Zeile entfernen",
    harmonicAmplitudes: "Harmonische Amplituden",
    valueList: "Werteliste",
    startValue: "Startwert",
    segmentsLengthValue: "Segmente (Laenge, Wert)",
    nh: "nh (Harmonische)",
    lh: "lh (niedrigste Harmonische)",
    rMultiplier: "r (Multiplikator)",
    gen17Hint:
      "Aufsteigende x/y-Paare eingeben. GEN17 verwendet oft negativen Generator-Modus (Normalisierung deaktivieren) fuer rohe Mappings.",
    xyPairs: "x/y-Paare",
    windowType: "Fenstertyp",
    max: "max",
    opt: "opt",
    gen20NoOpt: "Dieser Fenstertyp verwendet keinen optionalen GEN20-Parameter.",
    uploadAudioFile: "Audiodatei hochladen",
    uploading: "Lade hoch...",
    clearAsset: "Asset entfernen",
    persistedAsset: "Persistiertes Asset",
    fallbackSamplePath: "Fallback-Samplepfad (optional)",
    skipTime: "Startoffset",
    format: "Format",
    channel: "Kanal",
    rawArguments: "Raw-Argumente",
    rawArgsHelpBeforeExpr: "Kommas oder neue Zeilen verwenden. Strings in Anfuehrungszeichen setzen. Praefix",
    rawArgsHelpExprPrefix: "expr:",
    rawArgsHelpAfterExpr: "fuer unquotierten Ausdruck.",
    preview: "Vorschau",
    effectiveGen: "Effektives GEN",
    flattenedArgs: "Aufgeloeste Args",
    renderedLine: "Gerenderte Zeile",
    none: "(keine)",
    notes: "Hinweise",
    gen01Note:
      "GEN01 verwendet das hochgeladene Asset, falls vorhanden. Der Backend-Compiler loest es zum gespeicherten Dateipfad auf.",
    ftgenonceNote:
      "`ftgenonce` ignoriert Startzeit und verwendet denselben Tabellenparameter wie das erste `ftgenonce`-Argument.",
    cancel: "Abbrechen",
    saveGen: "GEN speichern",
    customRoutineOption: (routineNumber) => `Benutzerdef. GEN${routineNumber}`,
    configureGenNodeAria: (nodeId) => `GEN-Editor fuer ${nodeId}`,
    routineLabels: {
      1: "GEN01 - Audiodatei",
      2: "GEN02 - Werteliste",
      7: "GEN07 - Segmente",
      10: "GEN10 - Harmonische Sinus-Teiltone",
      11: "GEN11 - Harmonische Kosinus-Teiltone",
      17: "GEN17 - Stufentabelle aus x/y-Paaren",
      20: "GEN20 - Fenster / Verteilungsfunktion"
    },
    routineDescriptions: {
      1: "Laedt eine Audiodatei in eine Funktionstabelle (Upload-Asset oder benutzerdefinierter Pfad).",
      2: "Trage Literalwerte ein, die in die Tabelle kopiert werden.",
      7: "Definiere Startwert und Liniensegmente ueber Laenge/Wert-Paare.",
      10: "Trage harmonische Amplituden ein (1., 2., 3. Partial, ...).",
      11: "Anzahl Harmonische, niedrigste Harmonische und Harmonik-Multiplikator festlegen.",
      17: "x/y-Paare fuer gestufte Lookup-Mappings festlegen (oft unnormalisiert).",
      20: "Fenster/Verteilung ueber Fenstertyp, Maximalwert und optionalen Parameter erzeugen."
    },
    gen20WindowLabels: {
      1: "Hamming",
      2: "Hanning",
      3: "Bartlett (Dreieck)",
      4: "Blackman (3-Term)",
      5: "Blackman-Harris (4-Term)",
      6: "Gaussian",
      7: "Kaiser",
      8: "Rechteck",
      9: "Sinc"
    },
    customWindowOption: (value) => `Benutzerdef. ${value}`
  },
  french: {
    title: "Editeur GEN",
    nodeLabel: "Noeud",
    close: "Fermer",
    tableGenerationMode: "Generation de table",
    opcode: "Opcode",
    genRoutine: "Routine GEN",
    routineNumber: "Numero de routine",
    tableNumber: "Numero de table",
    tableSize: "Taille de table",
    startTime: "Temps de depart",
    normalizeTable: "Normaliser la table (utiliser un numero GEN positif)",
    customRoutineNoteBeforeExpr:
      "Routine GEN personnalisee. Utilisez l'editeur d'arguments bruts ci-dessous. Mettez les chaines entre guillemets. Utilisez",
    customRoutineNoteExprPrefix: "expr:",
    customRoutineNoteAfterExpr: "pour forcer une expression non quotee.",
    routineParameters: "Parametres de routine",
    add: "Ajouter",
    deleteShort: "Suppr",
    keepAtLeastOneEntry: "Conserver au moins une entree",
    removeRow: "Supprimer ligne",
    harmonicAmplitudes: "Amplitudes harmoniques",
    valueList: "Liste de valeurs",
    startValue: "Valeur initiale",
    segmentsLengthValue: "Segments (longueur, valeur)",
    nh: "nh (harmoniques)",
    lh: "lh (plus basse harmonique)",
    rMultiplier: "r (multiplicateur)",
    gen17Hint:
      "Saisissez des paires x/y croissantes. GEN17 utilise souvent un mode generateur negatif (normalisation desactivee) pour des mappings bruts.",
    xyPairs: "Paires x/y",
    windowType: "Type de fenetre",
    max: "max",
    opt: "opt",
    gen20NoOpt: "Ce type de fenetre n'utilise pas le parametre optionnel GEN20.",
    uploadAudioFile: "Televerser un fichier audio",
    uploading: "Televersement...",
    clearAsset: "Effacer asset",
    persistedAsset: "Asset persiste",
    fallbackSamplePath: "Chemin sample de secours (optionnel)",
    skipTime: "Temps de saut",
    format: "Format",
    channel: "Canal",
    rawArguments: "Arguments bruts",
    rawArgsHelpBeforeExpr: "Utilisez des virgules ou des nouvelles lignes. Les chaines doivent etre quotees. Prefixe",
    rawArgsHelpExprPrefix: "expr:",
    rawArgsHelpAfterExpr: "pour emettre une expression non quotee.",
    preview: "Apercu",
    effectiveGen: "GEN effectif",
    flattenedArgs: "Args aplatits",
    renderedLine: "Ligne rendue",
    none: "(aucun)",
    notes: "Notes",
    gen01Note:
      "GEN01 utilise l'asset televerse s'il est present. Le compilateur backend le resolut vers le chemin de fichier stocke.",
    ftgenonceNote:
      "`ftgenonce` ignore le temps de depart et utilise le meme parametre de table que le premier argument `ftgenonce`.",
    cancel: "Annuler",
    saveGen: "Enregistrer GEN",
    customRoutineOption: (routineNumber) => `GEN${routineNumber} perso`,
    configureGenNodeAria: (nodeId) => `Editeur GEN pour ${nodeId}`,
    routineLabels: {
      1: "GEN01 - Fichier audio",
      2: "GEN02 - Liste de valeurs",
      7: "GEN07 - Segments",
      10: "GEN10 - Partielles sinus harmoniques",
      11: "GEN11 - Partielles cosinus harmoniques",
      17: "GEN17 - Table par paires x/y",
      20: "GEN20 - Fonction fenetre / distribution"
    },
    routineDescriptions: {
      1: "Charge un fichier audio dans une table de fonction (asset televerse ou chemin personnalise).",
      2: "Saisissez des valeurs litterales copiees dans la table.",
      7: "Definissez une valeur initiale et des segments par paires longueur/valeur.",
      10: "Saisissez les amplitudes harmoniques (1re, 2e, 3e partielle, ...).",
      11: "Definir nombre d'harmoniques, plus basse harmonique et multiplicateur harmonique.",
      17: "Definir des paires x/y pour des mappings lookup par paliers (souvent non normalises).",
      20: "Generer une fenetre/distribution par type de fenetre, valeur max et parametre optionnel."
    },
    gen20WindowLabels: {
      1: "Hamming",
      2: "Hanning",
      3: "Bartlett (triangle)",
      4: "Blackman (3-termes)",
      5: "Blackman-Harris (4-termes)",
      6: "Gaussienne",
      7: "Kaiser",
      8: "Rectangle",
      9: "Sinc"
    },
    customWindowOption: (value) => `Personnalise ${value}`
  },
  spanish: {
    title: "Editor GEN",
    nodeLabel: "Nodo",
    close: "Cerrar",
    tableGenerationMode: "Generacion de tabla",
    opcode: "Opcode",
    genRoutine: "Rutina GEN",
    routineNumber: "Numero de rutina",
    tableNumber: "Numero de tabla",
    tableSize: "Tamano de tabla",
    startTime: "Tiempo inicial",
    normalizeTable: "Normalizar tabla (usar numero GEN positivo)",
    customRoutineNoteBeforeExpr:
      "Rutina GEN personalizada. Usa el editor de argumentos raw abajo. Pon las cadenas entre comillas. Usa",
    customRoutineNoteExprPrefix: "expr:",
    customRoutineNoteAfterExpr: "para forzar una expresion sin comillas.",
    routineParameters: "Parametros de rutina",
    add: "Agregar",
    deleteShort: "Borr",
    keepAtLeastOneEntry: "Mantener al menos una entrada",
    removeRow: "Eliminar fila",
    harmonicAmplitudes: "Amplitudes armonicas",
    valueList: "Lista de valores",
    startValue: "Valor inicial",
    segmentsLengthValue: "Segmentos (longitud, valor)",
    nh: "nh (armonicos)",
    lh: "lh (armonico mas bajo)",
    rMultiplier: "r (multiplicador)",
    gen17Hint:
      "Introduce pares x/y ascendentes. GEN17 suele usar modo de generador negativo (desactivar normalizacion) para mapeos crudos.",
    xyPairs: "Pares x/y",
    windowType: "Tipo de ventana",
    max: "max",
    opt: "opt",
    gen20NoOpt: "Este tipo de ventana no usa el parametro opcional de GEN20.",
    uploadAudioFile: "Subir archivo de audio",
    uploading: "Subiendo...",
    clearAsset: "Limpiar asset",
    persistedAsset: "Asset persistido",
    fallbackSamplePath: "Ruta de sample alternativa (opcional)",
    skipTime: "Tiempo de salto",
    format: "Formato",
    channel: "Canal",
    rawArguments: "Argumentos raw",
    rawArgsHelpBeforeExpr: "Usa comas o lineas nuevas. Las cadenas deben ir entre comillas. Prefijo",
    rawArgsHelpExprPrefix: "expr:",
    rawArgsHelpAfterExpr: "para emitir una expresion sin comillas.",
    preview: "Vista previa",
    effectiveGen: "GEN efectivo",
    flattenedArgs: "Args aplanados",
    renderedLine: "Linea renderizada",
    none: "(ninguno)",
    notes: "Notas",
    gen01Note:
      "GEN01 usa el asset subido si existe. El compilador backend lo resuelve a la ruta del archivo almacenado.",
    ftgenonceNote:
      "`ftgenonce` ignora Start Time y usa el mismo parametro de tabla que el primer argumento de `ftgenonce`.",
    cancel: "Cancelar",
    saveGen: "Guardar GEN",
    customRoutineOption: (routineNumber) => `GEN${routineNumber} personalizado`,
    configureGenNodeAria: (nodeId) => `Editor GEN para ${nodeId}`,
    routineLabels: {
      1: "GEN01 - Archivo de audio",
      2: "GEN02 - Lista de valores",
      7: "GEN07 - Segmentos",
      10: "GEN10 - Parciales seno armonicos",
      11: "GEN11 - Parciales coseno armonicos",
      17: "GEN17 - Tabla escalonada por pares x/y",
      20: "GEN20 - Funcion de ventana / distribucion"
    },
    routineDescriptions: {
      1: "Carga un archivo de audio en una tabla de funcion (asset subido o ruta personalizada).",
      2: "Introduce valores literales copiados a la tabla.",
      7: "Define un valor inicial y segmentos con pares longitud/valor.",
      10: "Introduce amplitudes armonicas (1er, 2do, 3er parcial, ...).",
      11: "Especifica numero de armonicos, armonico mas bajo y multiplicador armonico.",
      17: "Especifica pares x/y para mapeos escalonados de lookup (a menudo sin normalizar).",
      20: "Genera una ventana/distribucion por tipo de ventana, valor maximo y parametro opcional."
    },
    gen20WindowLabels: {
      1: "Hamming",
      2: "Hanning",
      3: "Bartlett (triangulo)",
      4: "Blackman (3 terminos)",
      5: "Blackman-Harris (4 terminos)",
      6: "Gaussiana",
      7: "Kaiser",
      8: "Rectangular",
      9: "Sinc"
    },
    customWindowOption: (value) => `Personalizado ${value}`
  }
};

function gen20WindowOptionsForLanguage(copy: GenEditorCopy): Array<{ value: number; label: string }> {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].map((value) => ({
    value,
    label: `${value} - ${copy.gen20WindowLabels[value] ?? "Window"}`
  }));
}

interface GenNodeEditorModalProps {
  nodeId: string;
  guiLanguage: GuiLanguage;
  initialConfig: GenNodeConfig;
  onClose: () => void;
  onSave: (config: GenNodeConfig) => void;
}

function parseNumericInput(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntegerInput(value: string, fallback: number): number {
  return Math.round(parseNumericInput(value, fallback));
}

function NumberListEditor({
  label,
  values,
  onChange,
  addLabel,
  deleteLabel,
  keepOneTitle,
  removeRowTitle
}: {
  label: string;
  values: number[];
  onChange: (values: number[]) => void;
  addLabel: string;
  deleteLabel: string;
  keepOneTitle: string;
  removeRowTitle: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
        <button
          type="button"
          onClick={() => onChange([...values, 0])}
          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-cyan-400/70 hover:text-cyan-200"
        >
          {addLabel}
        </button>
      </div>
      <div className="space-y-2">
        {values.map((entry, index) => (
          <div key={`${label}-${index}`} className="flex items-center gap-2">
            <div className="w-8 shrink-0 text-right font-mono text-[11px] text-slate-400">{index + 1}</div>
            <input
              type="text"
              value={String(entry)}
              onChange={(event) => {
                const next = [...values];
                next[index] = parseNumericInput(event.target.value, next[index] ?? 0);
                onChange(next);
              }}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
            />
            <button
              type="button"
              onClick={() => onChange(values.filter((_, rowIndex) => rowIndex !== index))}
              className="rounded-md border border-rose-500/50 bg-rose-950/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-900/30"
              disabled={values.length <= 1}
              title={values.length <= 1 ? keepOneTitle : removeRowTitle}
            >
              {deleteLabel}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GenNodeEditorModal({ nodeId, guiLanguage, initialConfig, onClose, onSave }: GenNodeEditorModalProps) {
  const copy = GEN_EDITOR_COPY[guiLanguage];
  const [draft, setDraft] = useState<GenNodeConfig>(() => normalizeGenNodeConfig(initialConfig));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(normalizeGenNodeConfig(initialConfig));
    setUploadError(null);
  }, [initialConfig]);

  const routineKind = useMemo(() => genRoutineKindForNumber(draft.routineNumber), [draft.routineNumber]);
  const selectedRoutine = useMemo(
    () => GEN_ROUTINE_OPTIONS.find((option) => option.value === Math.abs(Math.round(draft.routineNumber))),
    [draft.routineNumber]
  );
  const preview = useMemo(() => buildGenNodePreview(draft), [draft]);
  const gen20WindowOptions = useMemo(() => gen20WindowOptionsForLanguage(copy), [copy]);
  const localizedRoutineLabel = (value: number, fallback: string): string => copy.routineLabels[value] ?? fallback;

  const setSampleAsset = (asset: GenAudioAssetRef | null) => {
    setDraft((current) => ({ ...current, sampleAsset: asset }));
  };

  const handleUploadFile = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const uploaded = await api.uploadGenAudioAsset(file);
      setDraft((current) => ({
        ...current,
        sampleAsset: uploaded,
        samplePath: ""
      }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Failed to upload audio file.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1260] flex items-center justify-center bg-slate-950/80 p-4" onMouseDown={onClose}>
      <section
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={copy.configureGenNodeAria(nodeId)}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-700 px-4 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">{copy.title}</h2>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
              {copy.nodeLabel} {nodeId}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400"
          >
            {copy.close}
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="space-y-4">
            <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                {copy.tableGenerationMode}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.opcode}</span>
                  <select
                    value={draft.mode}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        mode: event.target.value === "ftgenonce" ? "ftgenonce" : "ftgen"
                      }))
                    }
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                  >
                    <option value="ftgen">ftgen</option>
                    <option value="ftgenonce">ftgenonce</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.genRoutine}</span>
                  <select
                    value={String(Math.abs(Math.round(draft.routineNumber)))}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        routineNumber: Math.max(1, parseIntegerInput(event.target.value, current.routineNumber))
                      }))
                    }
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                  >
                    {GEN_ROUTINE_OPTIONS.map((option) => (
                      <option key={`gen-routine-${option.value}`} value={option.value}>
                        {localizedRoutineLabel(option.value, option.label)}
                      </option>
                    ))}
                    {!selectedRoutine ? (
                      <option value={Math.abs(Math.round(draft.routineNumber))}>
                        {copy.customRoutineOption(Math.abs(Math.round(draft.routineNumber)))}
                      </option>
                    ) : null}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.routineNumber}</span>
                  <input
                    type="text"
                    value={String(Math.abs(Math.round(draft.routineNumber)))}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        routineNumber: Math.max(1, parseIntegerInput(event.target.value, current.routineNumber))
                      }))
                    }
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.tableNumber}</span>
                  <input
                    type="text"
                    value={String(draft.tableNumber)}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, tableNumber: parseIntegerInput(event.target.value, current.tableNumber) }))
                    }
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.tableSize}</span>
                  <input
                    type="text"
                    value={String(draft.tableSize)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        tableSize: Math.max(1, parseIntegerInput(event.target.value, current.tableSize))
                      }))
                    }
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.startTime}</span>
                  <input
                    type="text"
                    value={String(draft.startTime)}
                    disabled={draft.mode === "ftgenonce"}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, startTime: parseNumericInput(event.target.value, current.startTime) }))
                    }
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </label>

                <label className="flex items-center gap-3 rounded-md border border-slate-700 bg-slate-900 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={draft.normalize}
                    onChange={(event) => setDraft((current) => ({ ...current, normalize: event.target.checked }))}
                    className="h-4 w-4 accent-cyan-400"
                  />
                  <span className="text-xs text-slate-200">{copy.normalizeTable}</span>
                </label>
              </div>

              {selectedRoutine && (
                <p className="mt-3 text-xs text-slate-300">
                  <span className="font-semibold text-slate-200">
                    {localizedRoutineLabel(selectedRoutine.value, selectedRoutine.label)}
                  </span>
                  :{" "}
                  {copy.routineDescriptions[selectedRoutine.value] ?? selectedRoutine.description}
                </p>
              )}
              {!selectedRoutine && (
                <p className="mt-3 text-xs text-slate-400">
                  {copy.customRoutineNoteBeforeExpr}{" "}
                  <span className="mx-1 rounded bg-slate-800 px-1 py-0.5 font-mono text-[11px]">
                    {copy.customRoutineNoteExprPrefix}
                  </span>{" "}
                  {copy.customRoutineNoteAfterExpr}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                {copy.routineParameters}
              </div>

              {routineKind === "gen10" && (
                <NumberListEditor
                  label={copy.harmonicAmplitudes}
                  values={draft.harmonicAmplitudes}
                  onChange={(values) => setDraft((current) => ({ ...current, harmonicAmplitudes: values }))}
                  addLabel={copy.add}
                  deleteLabel={copy.deleteShort}
                  keepOneTitle={copy.keepAtLeastOneEntry}
                  removeRowTitle={copy.removeRow}
                />
              )}

              {routineKind === "gen11" && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.nh}</span>
                    <input
                      type="text"
                      value={String(draft.gen11HarmonicCount)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          gen11HarmonicCount: Math.max(1, parseIntegerInput(event.target.value, current.gen11HarmonicCount))
                        }))
                      }
                      className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.lh}</span>
                    <input
                      type="text"
                      value={String(draft.gen11LowestHarmonic)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          gen11LowestHarmonic: Math.max(1, parseIntegerInput(event.target.value, current.gen11LowestHarmonic))
                        }))
                      }
                      className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.rMultiplier}</span>
                    <input
                      type="text"
                      value={String(draft.gen11Multiplier)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          gen11Multiplier: parseNumericInput(event.target.value, current.gen11Multiplier)
                        }))
                      }
                      className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                    />
                  </label>
                </div>
              )}

              {routineKind === "gen2" && (
                <NumberListEditor
                  label={copy.valueList}
                  values={draft.valueList}
                  onChange={(values) => setDraft((current) => ({ ...current, valueList: values }))}
                  addLabel={copy.add}
                  deleteLabel={copy.deleteShort}
                  keepOneTitle={copy.keepAtLeastOneEntry}
                  removeRowTitle={copy.removeRow}
                />
              )}

              {routineKind === "gen7" && (
                <div className="space-y-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.startValue}</span>
                    <input
                      type="text"
                      value={String(draft.segmentStartValue)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          segmentStartValue: parseNumericInput(event.target.value, current.segmentStartValue)
                        }))
                      }
                      className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                    />
                  </label>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                        {copy.segmentsLengthValue}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            segments: [...current.segments, { length: Math.max(1, current.tableSize), value: 0 }]
                          }))
                        }
                        className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-cyan-400/70 hover:text-cyan-200"
                      >
                        {copy.add}
                      </button>
                    </div>
                    {draft.segments.map((segment, index) => (
                      <div key={`segment-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <input
                          type="text"
                          value={String(segment.length)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              segments: current.segments.map((row, rowIndex) =>
                                rowIndex === index
                                  ? {
                                      ...row,
                                      length: Math.max(1, parseNumericInput(event.target.value, row.length))
                                    }
                                  : row
                              )
                            }))
                          }
                          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                          placeholder="Length"
                        />
                        <input
                          type="text"
                          value={String(segment.value)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              segments: current.segments.map((row, rowIndex) =>
                                rowIndex === index
                                  ? {
                                      ...row,
                                      value: parseNumericInput(event.target.value, row.value)
                                    }
                                  : row
                              )
                            }))
                          }
                          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                          placeholder="Value"
                        />
                        <button
                          type="button"
                          disabled={draft.segments.length <= 1}
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              segments: current.segments.filter((_, rowIndex) => rowIndex !== index)
                            }))
                          }
                          className="rounded-md border border-rose-500/50 bg-rose-950/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-900/30 disabled:opacity-40"
                        >
                          {copy.deleteShort}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {routineKind === "gen17" && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">{copy.gen17Hint}</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                        {copy.xyPairs}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            gen17Pairs: [...current.gen17Pairs, { x: current.gen17Pairs.length * 16, y: 0 }]
                          }))
                        }
                        className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-cyan-400/70 hover:text-cyan-200"
                      >
                        {copy.add}
                      </button>
                    </div>

                    {draft.gen17Pairs.map((pair, index) => (
                      <div key={`gen17-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <input
                          type="text"
                          value={String(pair.x)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              gen17Pairs: current.gen17Pairs.map((row, rowIndex) =>
                                rowIndex === index
                                  ? { ...row, x: parseNumericInput(event.target.value, row.x) }
                                  : row
                              )
                            }))
                          }
                          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                          placeholder="x"
                        />
                        <input
                          type="text"
                          value={String(pair.y)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              gen17Pairs: current.gen17Pairs.map((row, rowIndex) =>
                                rowIndex === index
                                  ? { ...row, y: parseNumericInput(event.target.value, row.y) }
                                  : row
                              )
                            }))
                          }
                          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                          placeholder="y"
                        />
                        <button
                          type="button"
                          disabled={draft.gen17Pairs.length <= 1}
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              gen17Pairs: current.gen17Pairs.filter((_, rowIndex) => rowIndex !== index)
                            }))
                          }
                          className="rounded-md border border-rose-500/50 bg-rose-950/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-900/30 disabled:opacity-40"
                        >
                          {copy.deleteShort}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {routineKind === "gen20" && (
                <div className="space-y-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.windowType}</span>
                    <select
                      value={String(draft.gen20WindowType)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          gen20WindowType: Math.max(1, parseIntegerInput(event.target.value, current.gen20WindowType))
                        }))
                      }
                      className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                    >
                      {gen20WindowOptions.map((option) => (
                        <option key={`gen20-window-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                      {!gen20WindowOptions.some((option) => option.value === draft.gen20WindowType) ? (
                        <option value={draft.gen20WindowType}>{copy.customWindowOption(draft.gen20WindowType)}</option>
                      ) : null}
                    </select>
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.max}</span>
                      <input
                        type="text"
                        value={String(draft.gen20Max)}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            gen20Max: parseNumericInput(event.target.value, current.gen20Max)
                          }))
                        }
                        className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                      />
                    </label>

                    {[6, 7, 9].includes(Math.max(1, Math.round(draft.gen20WindowType))) ? (
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.opt}</span>
                        <input
                          type="text"
                          value={String(draft.gen20Opt)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              gen20Opt: parseNumericInput(event.target.value, current.gen20Opt)
                            }))
                          }
                          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                        />
                      </label>
                    ) : (
                      <div className="rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-400">
                        {copy.gen20NoOpt}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {routineKind === "gen1" && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="rounded-md border border-cyan-500/60 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-50"
                      >
                        {uploading ? copy.uploading : copy.uploadAudioFile}
                      </button>
                      {draft.sampleAsset ? (
                        <button
                          type="button"
                          onClick={() => setSampleAsset(null)}
                          className="rounded-md border border-rose-500/50 bg-rose-950/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-900/30"
                        >
                          {copy.clearAsset}
                        </button>
                      ) : null}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*,.wav,.aif,.aiff,.flac,.mp3,.ogg"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) {
                          void handleUploadFile(file);
                        }
                      }}
                    />

                    {draft.sampleAsset ? (
                      <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-950/20 px-2 py-2 text-xs text-emerald-100">
                        <div className="font-semibold">
                          {copy.persistedAsset}: {draft.sampleAsset.original_name}
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-emerald-200/90">
                          {draft.sampleAsset.stored_name}
                        </div>
                      </div>
                    ) : null}

                    {uploadError ? (
                      <div className="mt-2 rounded-md border border-rose-500/50 bg-rose-950/30 px-2 py-1.5 text-xs text-rose-200">
                        {uploadError}
                      </div>
                    ) : null}
                  </div>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                      {copy.fallbackSamplePath}
                    </span>
                    <input
                      type="text"
                      value={draft.samplePath}
                      onChange={(event) => setDraft((current) => ({ ...current, samplePath: event.target.value }))}
                      placeholder="/absolute/path/file.wav"
                      className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.skipTime}</span>
                      <input
                        type="text"
                        value={String(draft.sampleSkipTime)}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            sampleSkipTime: parseNumericInput(event.target.value, current.sampleSkipTime)
                          }))
                        }
                        className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.format}</span>
                      <input
                        type="text"
                        value={String(draft.sampleFormat)}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            sampleFormat: parseIntegerInput(event.target.value, current.sampleFormat)
                          }))
                        }
                        className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.channel}</span>
                      <input
                        type="text"
                        value={String(draft.sampleChannel)}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            sampleChannel: parseIntegerInput(event.target.value, current.sampleChannel)
                          }))
                        }
                        className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                      />
                    </label>
                  </div>
                </div>
              )}

              {routineKind === "raw" && (
                <div className="space-y-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.rawArguments}</span>
                    <textarea
                      value={draft.rawArgsText}
                      onChange={(event) => setDraft((current) => ({ ...current, rawArgsText: event.target.value }))}
                      placeholder={'Example: 1, 0.5, expr:1024*2, "file.wav"'}
                      className="min-h-[120px] rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                    />
                  </label>
                  <p className="text-xs text-slate-400">
                    {copy.rawArgsHelpBeforeExpr}{" "}
                    <span className="font-mono text-slate-300">{copy.rawArgsHelpExprPrefix}</span>{" "}
                    {copy.rawArgsHelpAfterExpr}
                  </p>
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{copy.preview}</div>
              <div className="space-y-2 text-xs text-slate-300">
                <div className="rounded-md border border-slate-700 bg-slate-900 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{copy.effectiveGen}</div>
                  <div className="mt-1 font-mono text-slate-100">{preview.igen}</div>
                </div>
                <div className="rounded-md border border-slate-700 bg-slate-900 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{copy.flattenedArgs}</div>
                  <div className="mt-1 break-words font-mono text-[11px] text-slate-100">
                    {preview.args.length > 0 ? preview.args.join(", ") : copy.none}
                  </div>
                </div>
                <div className="rounded-md border border-slate-700 bg-slate-900 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{copy.renderedLine}</div>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-cyan-100">
                    {preview.line}
                  </pre>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-400">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{copy.notes}</div>
              <div>{copy.gen01Note}</div>
              <div className="mt-2">{copy.ftgenonceNote}</div>
            </div>
          </aside>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-700 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-200 transition hover:border-slate-400"
          >
            {copy.cancel}
          </button>
          <button
            type="button"
            onClick={() => onSave(normalizeGenNodeConfig(draft))}
            className="rounded-md border border-cyan-500/70 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200 transition hover:bg-cyan-500/25"
          >
            {copy.saveGen}
          </button>
        </footer>
      </section>
    </div>
  );
}
