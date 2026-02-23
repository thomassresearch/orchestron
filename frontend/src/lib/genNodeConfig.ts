import type { JsonObject, JsonValue } from "../types";

export const GEN_NODES_LAYOUT_KEY = "gen_nodes";

export type GenNodeMode = "ftgen" | "ftgenonce";

export interface GenAudioAssetRef {
  asset_id: string;
  original_name: string;
  stored_name: string;
  content_type: string;
  size_bytes: number;
}

export interface GenSegmentPoint {
  length: number;
  value: number;
}

export interface GenXYPoint {
  x: number;
  y: number;
}

export interface GenNodeConfig {
  mode: GenNodeMode;
  tableNumber: number;
  startTime: number;
  tableSize: number;
  routineNumber: number;
  normalize: boolean;
  harmonicAmplitudes: number[];
  gen11HarmonicCount: number;
  gen11LowestHarmonic: number;
  gen11Multiplier: number;
  valueList: number[];
  segmentStartValue: number;
  segments: GenSegmentPoint[];
  gen17Pairs: GenXYPoint[];
  gen20WindowType: number;
  gen20Max: number;
  gen20Opt: number;
  sampleAsset: GenAudioAssetRef | null;
  samplePath: string;
  sampleSkipTime: number;
  sampleFormat: number;
  sampleChannel: number;
  rawArgsText: string;
}

export interface GenNodePreview {
  igen: number;
  mode: GenNodeMode;
  args: string[];
  line: string;
}

type GenNodeConfigMap = Record<string, GenNodeConfig>;

export type GenRoutineEditorKind = "gen10" | "gen11" | "gen2" | "gen7" | "gen17" | "gen20" | "gen1" | "raw";

export interface GenRoutineOption {
  value: number;
  label: string;
  kind: GenRoutineEditorKind;
  description: string;
}

export const GEN_ROUTINE_OPTIONS: GenRoutineOption[] = [
  {
    value: 10,
    label: "GEN10 - Harmonic Sine Partials",
    kind: "gen10",
    description: "Enter harmonic amplitudes (1st, 2nd, 3rd partial, ...)."
  },
  {
    value: 11,
    label: "GEN11 - Harmonic Cosine Partials",
    kind: "gen11",
    description: "Specify number of harmonics, lowest harmonic, and harmonic multiplier."
  },
  {
    value: 2,
    label: "GEN02 - Value List",
    kind: "gen2",
    description: "Enter literal values copied into the table."
  },
  {
    value: 7,
    label: "GEN07 - Segments",
    kind: "gen7",
    description: "Define a start value and line segments using length/value pairs."
  },
  {
    value: 17,
    label: "GEN17 - Step Table From x/y Pairs",
    kind: "gen17",
    description: "Specify x/y point pairs for stepped lookup mappings (often used unnormalized)."
  },
  {
    value: 20,
    label: "GEN20 - Window / Distribution Function",
    kind: "gen20",
    description: "Generate a window or distribution by window type, max value, and optional parameter."
  },
  {
    value: 1,
    label: "GEN01 - Audio File",
    kind: "gen1",
    description: "Load a sound file into a function table (uploaded asset or custom path)."
  }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[-+]?\d+$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }
    if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
      return Number.parseFloat(trimmed);
    }
  }
  return fallback;
}

function toInt(value: unknown, fallback: number): number {
  return Math.round(toNumber(value, fallback));
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function toNumberList(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const result = value
    .map((entry) => toNumber(entry, Number.NaN))
    .filter((entry) => Number.isFinite(entry))
    .map((entry) => Number(entry));
  return result.length > 0 ? result : [...fallback];
}

function parseSegmentList(value: unknown, fallback: GenSegmentPoint[]): GenSegmentPoint[] {
  if (!Array.isArray(value)) {
    return fallback.map((entry) => ({ ...entry }));
  }
  const result: GenSegmentPoint[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const length = toNumber(entry.length, Number.NaN);
    const pointValue = toNumber(entry.value, Number.NaN);
    if (!Number.isFinite(length) || !Number.isFinite(pointValue)) {
      continue;
    }
    result.push({ length: Number(length), value: Number(pointValue) });
  }
  return result.length > 0 ? result : fallback.map((entry) => ({ ...entry }));
}

function parseXYPointList(value: unknown, fallback: GenXYPoint[]): GenXYPoint[] {
  if (!Array.isArray(value)) {
    return fallback.map((entry) => ({ ...entry }));
  }
  const result: GenXYPoint[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const x = toNumber(entry.x, Number.NaN);
    const y = toNumber(entry.y, Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    result.push({ x: Number(x), y: Number(y) });
  }
  return result.length > 0 ? result : fallback.map((entry) => ({ ...entry }));
}

function parseSampleAsset(value: unknown): GenAudioAssetRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const assetId = typeof value.asset_id === "string" ? value.asset_id.trim() : "";
  const originalName = typeof value.original_name === "string" ? value.original_name.trim() : "";
  const storedName = typeof value.stored_name === "string" ? value.stored_name.trim() : "";
  if (!assetId || !originalName || !storedName) {
    return null;
  }
  return {
    asset_id: assetId,
    original_name: originalName,
    stored_name: storedName,
    content_type: typeof value.content_type === "string" ? value.content_type : "application/octet-stream",
    size_bytes: Math.max(1, toInt(value.size_bytes, 1))
  };
}

export function defaultGenNodeConfig(): GenNodeConfig {
  return {
    mode: "ftgen",
    tableNumber: 0,
    startTime: 0,
    tableSize: 16384,
    routineNumber: 10,
    normalize: true,
    harmonicAmplitudes: [1],
    gen11HarmonicCount: 8,
    gen11LowestHarmonic: 1,
    gen11Multiplier: 1,
    valueList: [1],
    segmentStartValue: 0,
    segments: [{ length: 16384, value: 1 }],
    gen17Pairs: [
      { x: 0, y: 0 },
      { x: 127, y: 127 }
    ],
    gen20WindowType: 1,
    gen20Max: 1,
    gen20Opt: 0.5,
    sampleAsset: null,
    samplePath: "",
    sampleSkipTime: 0,
    sampleFormat: 0,
    sampleChannel: 0,
    rawArgsText: ""
  };
}

export function normalizeGenNodeConfig(raw: unknown): GenNodeConfig {
  if (!isRecord(raw)) {
    return defaultGenNodeConfig();
  }

  const defaults = defaultGenNodeConfig();
  const mode: GenNodeMode =
    typeof raw.mode === "string" && raw.mode.trim().toLowerCase() === "ftgenonce" ? "ftgenonce" : "ftgen";
  let routineNumber = Math.abs(toInt(raw.routineNumber, defaults.routineNumber));
  if (routineNumber === 0) {
    routineNumber = defaults.routineNumber;
  }

  return {
    mode,
    tableNumber: toInt(raw.tableNumber, defaults.tableNumber),
    startTime: toNumber(raw.startTime, defaults.startTime),
    tableSize: toInt(raw.tableSize, defaults.tableSize),
    routineNumber,
    normalize: toBool(raw.normalize, defaults.normalize),
    harmonicAmplitudes: toNumberList(raw.harmonicAmplitudes, defaults.harmonicAmplitudes),
    gen11HarmonicCount: Math.max(1, toInt(raw.gen11HarmonicCount, defaults.gen11HarmonicCount)),
    gen11LowestHarmonic: Math.max(1, toInt(raw.gen11LowestHarmonic, defaults.gen11LowestHarmonic)),
    gen11Multiplier: toNumber(raw.gen11Multiplier, defaults.gen11Multiplier),
    valueList: toNumberList(raw.valueList, defaults.valueList),
    segmentStartValue: toNumber(raw.segmentStartValue, defaults.segmentStartValue),
    segments: parseSegmentList(raw.segments, defaults.segments),
    gen17Pairs: parseXYPointList(raw.gen17Pairs, defaults.gen17Pairs),
    gen20WindowType: Math.max(1, toInt(raw.gen20WindowType, defaults.gen20WindowType)),
    gen20Max: toNumber(raw.gen20Max, defaults.gen20Max),
    gen20Opt: toNumber(raw.gen20Opt, defaults.gen20Opt),
    sampleAsset: parseSampleAsset(raw.sampleAsset),
    samplePath: typeof raw.samplePath === "string" ? raw.samplePath : "",
    sampleSkipTime: toNumber(raw.sampleSkipTime, defaults.sampleSkipTime),
    sampleFormat: toInt(raw.sampleFormat, defaults.sampleFormat),
    sampleChannel: toInt(raw.sampleChannel, defaults.sampleChannel),
    rawArgsText: typeof raw.rawArgsText === "string" ? raw.rawArgsText : ""
  };
}

export function readGenNodeConfigMap(uiLayout: JsonObject): GenNodeConfigMap {
  const raw = uiLayout[GEN_NODES_LAYOUT_KEY];
  if (!isRecord(raw)) {
    return {};
  }

  const result: GenNodeConfigMap = {};
  for (const [nodeId, value] of Object.entries(raw)) {
    if (!nodeId.trim()) {
      continue;
    }
    result[nodeId] = normalizeGenNodeConfig(value);
  }
  return result;
}

export function getGenNodeConfig(uiLayout: JsonObject, nodeId: string): GenNodeConfig {
  const map = readGenNodeConfigMap(uiLayout);
  return map[nodeId] ? normalizeGenNodeConfig(map[nodeId]) : defaultGenNodeConfig();
}

export function writeGenNodeConfigMap(uiLayout: JsonObject, map: GenNodeConfigMap): JsonObject {
  const nextLayout: JsonObject = { ...uiLayout };
  const entries = Object.entries(map);
  if (entries.length === 0) {
    delete nextLayout[GEN_NODES_LAYOUT_KEY];
    return nextLayout;
  }

  const rawMap: Record<string, JsonValue> = {};
  for (const [nodeId, config] of entries) {
    rawMap[nodeId] = genNodeConfigToJson(config);
  }
  nextLayout[GEN_NODES_LAYOUT_KEY] = rawMap;
  return nextLayout;
}

export function setGenNodeConfig(uiLayout: JsonObject, nodeId: string, config: GenNodeConfig | null): JsonObject {
  const current = readGenNodeConfigMap(uiLayout);
  const next = { ...current };
  if (!config) {
    delete next[nodeId];
  } else {
    next[nodeId] = normalizeGenNodeConfig(config);
  }
  return writeGenNodeConfigMap(uiLayout, next);
}

function genNodeConfigToJson(config: GenNodeConfig): JsonValue {
  return {
    mode: config.mode,
    tableNumber: config.tableNumber,
    startTime: config.startTime,
    tableSize: config.tableSize,
    routineNumber: config.routineNumber,
    normalize: config.normalize,
    harmonicAmplitudes: config.harmonicAmplitudes,
    gen11HarmonicCount: config.gen11HarmonicCount,
    gen11LowestHarmonic: config.gen11LowestHarmonic,
    gen11Multiplier: config.gen11Multiplier,
    valueList: config.valueList,
    segmentStartValue: config.segmentStartValue,
    segments: config.segments.map((point) => ({ length: point.length, value: point.value })),
    gen17Pairs: config.gen17Pairs.map((point) => ({ x: point.x, y: point.y })),
    gen20WindowType: config.gen20WindowType,
    gen20Max: config.gen20Max,
    gen20Opt: config.gen20Opt,
    sampleAsset: config.sampleAsset
      ? {
          asset_id: config.sampleAsset.asset_id,
          original_name: config.sampleAsset.original_name,
          stored_name: config.sampleAsset.stored_name,
          content_type: config.sampleAsset.content_type,
          size_bytes: config.sampleAsset.size_bytes
        }
      : null,
    samplePath: config.samplePath,
    sampleSkipTime: config.sampleSkipTime,
    sampleFormat: config.sampleFormat,
    sampleChannel: config.sampleChannel,
    rawArgsText: config.rawArgsText
  } satisfies JsonObject;
}

export function genRoutineKindForNumber(routineNumber: number): GenRoutineEditorKind {
  const normalized = Math.abs(Math.round(routineNumber));
  return GEN_ROUTINE_OPTIONS.find((entry) => entry.value === normalized)?.kind ?? "raw";
}

function parseRawArgsText(rawArgsText: string): string[] {
  return rawArgsText
    .split(/[,\n]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function previewArgsForConfig(config: GenNodeConfig): string[] {
  const routineNumber = Math.abs(Math.round(config.routineNumber)) || 10;
  if (routineNumber === 10) {
    return (config.harmonicAmplitudes.length > 0 ? config.harmonicAmplitudes : [1]).map(String);
  }
  if (routineNumber === 11) {
    return [
      String(Math.max(1, Math.round(config.gen11HarmonicCount))),
      String(Math.max(1, Math.round(config.gen11LowestHarmonic))),
      String(config.gen11Multiplier)
    ];
  }
  if (routineNumber === 2) {
    return (config.valueList.length > 0 ? config.valueList : [1]).map(String);
  }
  if (routineNumber === 7) {
    const rows = config.segments.length > 0 ? config.segments : [{ length: config.tableSize || 16384, value: 1 }];
    const values = [String(config.segmentStartValue)];
    for (const row of rows) {
      values.push(String(row.length), String(row.value));
    }
    return values;
  }
  if (routineNumber === 17) {
    const pairs = config.gen17Pairs.length > 0 ? config.gen17Pairs : [{ x: 0, y: 0 }];
    const flattened: string[] = [];
    for (const pair of pairs) {
      flattened.push(String(pair.x), String(pair.y));
    }
    return flattened;
  }
  if (routineNumber === 20) {
    const windowType = Math.max(1, Math.round(config.gen20WindowType));
    const args = [String(windowType), String(config.gen20Max)];
    if ([6, 7, 9].includes(windowType)) {
      args.push(String(config.gen20Opt));
    }
    return args;
  }
  if (routineNumber === 1) {
    const fileArg = config.sampleAsset?.original_name || config.samplePath.trim() || "<audio-file>";
    return [
      JSON.stringify(fileArg),
      String(config.sampleSkipTime),
      String(config.sampleFormat),
      String(config.sampleChannel)
    ];
  }
  const rawTokens = parseRawArgsText(config.rawArgsText);
  return rawTokens.map((token) => {
    const isQuoted =
      (token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"));
    if (isQuoted) {
      return token;
    }
    if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(token) || /^[-+]?\d+$/.test(token)) {
      return token;
    }
    return `expr:${token}`;
  });
}

export function buildGenNodePreview(config: GenNodeConfig): GenNodePreview {
  const normalized = normalizeGenNodeConfig(config);
  const routineNumber = Math.abs(Math.round(normalized.routineNumber)) || 10;
  const igen = normalized.normalize ? routineNumber : -routineNumber;
  const args = previewArgsForConfig(normalized);
  const renderedArgs = args.map((arg) => (arg.startsWith("expr:") ? arg.slice(5) : arg));
  const effectiveMode: GenNodeMode = routineNumber === 1 ? "ftgen" : normalized.mode;

  const linePrefix =
    effectiveMode === "ftgenonce"
      ? "{ift} ftgenonce "
      : "{ift} ftgen ";
  const lineBase =
    effectiveMode === "ftgenonce"
      ? `${linePrefix}${normalized.tableNumber}, 0, ${normalized.tableSize}, ${igen}`
      : `${linePrefix}${normalized.tableNumber}, ${normalized.startTime}, ${normalized.tableSize}, ${igen}`;
  const line = renderedArgs.length > 0 ? `${lineBase}, ${renderedArgs.join(", ")}` : lineBase;

  return {
    igen,
    mode: effectiveMode,
    args,
    line
  };
}
