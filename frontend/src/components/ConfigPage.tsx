import { useEffect, useMemo, useState } from "react";

import { HelpIconButton } from "./HelpIconButton";
import {
  BROWSER_CLOCK_BOOST_MS_MAX,
  BROWSER_CLOCK_BOOST_MS_MIN,
  BROWSER_CLOCK_IMMEDIATE_COOLDOWN_MS_MAX,
  BROWSER_CLOCK_IMMEDIATE_COOLDOWN_MS_MIN,
  BROWSER_CLOCK_IMMEDIATE_RENDER_BLOCKS_MAX,
  BROWSER_CLOCK_IMMEDIATE_RENDER_BLOCKS_MIN,
  BROWSER_CLOCK_MAX_BLOCKS_MAX,
  BROWSER_CLOCK_MAX_BLOCKS_MIN,
  BROWSER_CLOCK_PARALLEL_REQUESTS_MAX,
  BROWSER_CLOCK_PARALLEL_REQUESTS_MIN,
  BROWSER_CLOCK_WATER_MS_MAX,
  BROWSER_CLOCK_WATER_MS_MIN
} from "../lib/browserClockLatencyConfig";
import type { BrowserClockLatencySettings, GuiLanguage, HelpDocId } from "../types";

const AUDIO_RATE_MIN = 22000;
const AUDIO_RATE_MAX = 48000;
const CONTROL_RATE_MIN = 25;
const CONTROL_RATE_MAX = 48000;
const ENGINE_BUFFER_MIN = 32;
const ENGINE_BUFFER_MAX = 8192;

type BrowserClockLatencyFieldKey = keyof BrowserClockLatencySettings;
type BrowserClockLatencyFormState = Record<BrowserClockLatencyFieldKey, string>;
type EngineInputFieldKey = "audioRate" | "controlRate" | "softwareBuffer" | "hardwareBuffer";
type EngineInputState = Record<EngineInputFieldKey, string>;

type ConfigPageCopy = {
  audioEngineConfiguration: string;
  audioEngineDescription: string;
  audioSampleRateHz: string;
  controlSampleRateHz: string;
  softwareBuffer: string;
  hardwareBuffer: string;
  applyConfiguration: string;
  derivedKsmps: string;
  actualControlRate: string;
  currentPatchEngineValues: string;
  controlRateTarget: string;
  softwareBufferMetric: string;
  hardwareBufferMetric: string;
  browserClockLatencyConfiguration: string;
  browserClockLatencyDescription: string;
  browserClockLatencyStorageNote: string;
  applyBrowserClockLatencyConfiguration: string;
  browserClockFields: Record<BrowserClockLatencyFieldKey, string>;
  integerValidation: (label: string) => string;
  rangeValidation: (label: string, min: number, max: number) => string;
  greaterThanValidation: (label: string, lowerLabel: string) => string;
  allowedRange: (min: number, max: number) => string;
};

const CONFIG_PAGE_COPY: Record<GuiLanguage, ConfigPageCopy> = {
  english: {
    audioEngineConfiguration: "Audio Engine Configuration",
    audioEngineDescription:
      "Configure audio-rate (`sr`), target control-rate sampling, and runtime buffer sizes. VisualCSound derives `ksmps` from sample rate and control rate.",
    audioSampleRateHz: "Audio Sample Rate (Hz)",
    controlSampleRateHz: "Control Sample Rate (Hz)",
    softwareBuffer: "Software Buffer (`-b`)",
    hardwareBuffer: "Hardware Buffer (`-B`)",
    applyConfiguration: "Apply Configuration",
    derivedKsmps: "Derived `ksmps`",
    actualControlRate: "Actual control rate (`sr/ksmps`)",
    currentPatchEngineValues: "Current Patch Engine Values",
    controlRateTarget: "control_rate (target)",
    softwareBufferMetric: "software_buffer (-b)",
    hardwareBufferMetric: "hardware_buffer (-B)",
    browserClockLatencyConfiguration: "Browser-Clock Latency",
    browserClockLatencyDescription:
      "Tune the browser PCM queue, render burst size, and request parallelism used by browser-clock audio. These settings only appear when the backend runs in browser-clock mode.",
    browserClockLatencyStorageNote: "Stored in app state, not in the current patch.",
    applyBrowserClockLatencyConfiguration: "Apply Browser-Clock Settings",
    browserClockFields: {
      steadyLowWaterMs: "Steady Low Water (ms)",
      steadyHighWaterMs: "Steady High Water (ms)",
      startupLowWaterMs: "Startup Low Water (ms)",
      startupHighWaterMs: "Startup High Water (ms)",
      underrunRecoveryBoostMs: "Underrun Recovery Boost (ms)",
      maxUnderrunBoostMs: "Max Underrun Boost (ms)",
      maxBlocksPerRequest: "Max Blocks Per Request",
      steadyMaxParallelRequests: "Steady Parallel Requests",
      startupMaxParallelRequests: "Startup Parallel Requests",
      recoveryMaxParallelRequests: "Recovery Parallel Requests",
      immediateRenderBlocks: "Immediate Note Render Blocks",
      immediateRenderCooldownMs: "Immediate Note Render Cooldown (ms)"
    },
    integerValidation: (label) => `${label} must be an integer.`,
    rangeValidation: (label, min, max) => `${label} must be between ${min} and ${max}.`,
    greaterThanValidation: (label, lowerLabel) => `${label} must be greater than ${lowerLabel}.`,
    allowedRange: (min, max) => `Allowed: ${min} - ${max}`
  },
  german: {
    audioEngineConfiguration: "Audio Engine Konfiguration",
    audioEngineDescription:
      "Konfiguriere Audio-Rate (`sr`), Ziel-Control-Rate und Runtime-Buffergroessen. VisualCSound berechnet `ksmps` aus Sample-Rate und Control-Rate.",
    audioSampleRateHz: "Audio-Sample-Rate (Hz)",
    controlSampleRateHz: "Control-Sample-Rate (Hz)",
    softwareBuffer: "Software-Buffer (`-b`)",
    hardwareBuffer: "Hardware-Buffer (`-B`)",
    applyConfiguration: "Konfiguration anwenden",
    derivedKsmps: "Abgeleitetes `ksmps`",
    actualControlRate: "Tatsaechliche Control-Rate (`sr/ksmps`)",
    currentPatchEngineValues: "Aktuelle Patch-Engine-Werte",
    controlRateTarget: "control_rate (ziel)",
    softwareBufferMetric: "software_buffer (-b)",
    hardwareBufferMetric: "hardware_buffer (-B)",
    browserClockLatencyConfiguration: "Browser-Clock-Latenz",
    browserClockLatencyDescription:
      "Stimme PCM-Warteschlange, Render-Burst-Groesse und Anfrage-Parallelitaet fuer Browser-Clock-Audio ab. Diese Werte erscheinen nur im Browser-Clock-Modus.",
    browserClockLatencyStorageNote: "Wird im App-State gespeichert, nicht im aktuellen Patch.",
    applyBrowserClockLatencyConfiguration: "Browser-Clock-Einstellungen anwenden",
    browserClockFields: {
      steadyLowWaterMs: "Steady Low Water (ms)",
      steadyHighWaterMs: "Steady High Water (ms)",
      startupLowWaterMs: "Startup Low Water (ms)",
      startupHighWaterMs: "Startup High Water (ms)",
      underrunRecoveryBoostMs: "Underrun Recovery Boost (ms)",
      maxUnderrunBoostMs: "Max Underrun Boost (ms)",
      maxBlocksPerRequest: "Max Blocks pro Anfrage",
      steadyMaxParallelRequests: "Steady parallele Anfragen",
      startupMaxParallelRequests: "Startup parallele Anfragen",
      recoveryMaxParallelRequests: "Recovery parallele Anfragen",
      immediateRenderBlocks: "Sofort-Render-Blocks fuer Note-On",
      immediateRenderCooldownMs: "Cooldown fuer Sofort-Render (ms)"
    },
    integerValidation: (label) => `${label} muss eine ganze Zahl sein.`,
    rangeValidation: (label, min, max) => `${label} muss zwischen ${min} und ${max} liegen.`,
    greaterThanValidation: (label, lowerLabel) => `${label} muss groesser als ${lowerLabel} sein.`,
    allowedRange: (min, max) => `Erlaubt: ${min} - ${max}`
  },
  french: {
    audioEngineConfiguration: "Configuration du moteur audio",
    audioEngineDescription:
      "Configurez le taux audio (`sr`), le taux de controle cible et les tailles de buffer runtime. VisualCSound derive `ksmps` depuis `sr` et le taux de controle.",
    audioSampleRateHz: "Frequence d'echantillonnage audio (Hz)",
    controlSampleRateHz: "Frequence d'echantillonnage controle (Hz)",
    softwareBuffer: "Buffer logiciel (`-b`)",
    hardwareBuffer: "Buffer materiel (`-B`)",
    applyConfiguration: "Appliquer configuration",
    derivedKsmps: "`ksmps` derive",
    actualControlRate: "Taux de controle reel (`sr/ksmps`)",
    currentPatchEngineValues: "Valeurs moteur du patch courant",
    controlRateTarget: "control_rate (cible)",
    softwareBufferMetric: "software_buffer (-b)",
    hardwareBufferMetric: "hardware_buffer (-B)",
    browserClockLatencyConfiguration: "Latence browser-clock",
    browserClockLatencyDescription:
      "Reglez la file PCM du navigateur, la taille des bursts de rendu et le parallelisme des requetes pour l'audio browser-clock. Cette section apparait uniquement en mode browser-clock.",
    browserClockLatencyStorageNote: "Stocke dans l'etat applicatif, pas dans le patch courant.",
    applyBrowserClockLatencyConfiguration: "Appliquer reglages browser-clock",
    browserClockFields: {
      steadyLowWaterMs: "Steady Low Water (ms)",
      steadyHighWaterMs: "Steady High Water (ms)",
      startupLowWaterMs: "Startup Low Water (ms)",
      startupHighWaterMs: "Startup High Water (ms)",
      underrunRecoveryBoostMs: "Underrun Recovery Boost (ms)",
      maxUnderrunBoostMs: "Max Underrun Boost (ms)",
      maxBlocksPerRequest: "Max blocks par requete",
      steadyMaxParallelRequests: "Requetes paralleles steady",
      startupMaxParallelRequests: "Requetes paralleles startup",
      recoveryMaxParallelRequests: "Requetes paralleles recovery",
      immediateRenderBlocks: "Blocks de rendu immediat note-on",
      immediateRenderCooldownMs: "Cooldown rendu immediat (ms)"
    },
    integerValidation: (label) => `${label} doit etre un entier.`,
    rangeValidation: (label, min, max) => `${label} doit etre entre ${min} et ${max}.`,
    greaterThanValidation: (label, lowerLabel) => `${label} doit etre superieur a ${lowerLabel}.`,
    allowedRange: (min, max) => `Autorise: ${min} - ${max}`
  },
  spanish: {
    audioEngineConfiguration: "Configuracion del motor de audio",
    audioEngineDescription:
      "Configura la tasa de audio (`sr`), la tasa de control objetivo y los tamanos de buffer runtime. VisualCSound deriva `ksmps` desde sample rate y control rate.",
    audioSampleRateHz: "Frecuencia de muestreo de audio (Hz)",
    controlSampleRateHz: "Frecuencia de muestreo de control (Hz)",
    softwareBuffer: "Buffer de software (`-b`)",
    hardwareBuffer: "Buffer de hardware (`-B`)",
    applyConfiguration: "Aplicar configuracion",
    derivedKsmps: "`ksmps` derivado",
    actualControlRate: "Tasa de control real (`sr/ksmps`)",
    currentPatchEngineValues: "Valores del motor en el patch actual",
    controlRateTarget: "control_rate (objetivo)",
    softwareBufferMetric: "software_buffer (-b)",
    hardwareBufferMetric: "hardware_buffer (-B)",
    browserClockLatencyConfiguration: "Latencia browser-clock",
    browserClockLatencyDescription:
      "Ajusta la cola PCM del navegador, el tamano de los bursts de render y el paralelismo de solicitudes usado por browser-clock. Esta seccion solo aparece en modo browser-clock.",
    browserClockLatencyStorageNote: "Se guarda en el estado de la app, no en el patch actual.",
    applyBrowserClockLatencyConfiguration: "Aplicar ajustes browser-clock",
    browserClockFields: {
      steadyLowWaterMs: "Steady Low Water (ms)",
      steadyHighWaterMs: "Steady High Water (ms)",
      startupLowWaterMs: "Startup Low Water (ms)",
      startupHighWaterMs: "Startup High Water (ms)",
      underrunRecoveryBoostMs: "Underrun Recovery Boost (ms)",
      maxUnderrunBoostMs: "Max Underrun Boost (ms)",
      maxBlocksPerRequest: "Max blocks por solicitud",
      steadyMaxParallelRequests: "Solicitudes paralelas steady",
      startupMaxParallelRequests: "Solicitudes paralelas startup",
      recoveryMaxParallelRequests: "Solicitudes paralelas recovery",
      immediateRenderBlocks: "Blocks de render inmediato note-on",
      immediateRenderCooldownMs: "Cooldown render inmediato (ms)"
    },
    integerValidation: (label) => `${label} debe ser un entero.`,
    rangeValidation: (label, min, max) => `${label} debe estar entre ${min} y ${max}.`,
    greaterThanValidation: (label, lowerLabel) => `${label} debe ser mayor que ${lowerLabel}.`,
    allowedRange: (min, max) => `Permitido: ${min} - ${max}`
  }
};

const BROWSER_CLOCK_FIELD_RANGES: Record<BrowserClockLatencyFieldKey, { min: number; max: number }> = {
  steadyLowWaterMs: { min: BROWSER_CLOCK_WATER_MS_MIN, max: BROWSER_CLOCK_WATER_MS_MAX },
  steadyHighWaterMs: { min: BROWSER_CLOCK_WATER_MS_MIN, max: BROWSER_CLOCK_WATER_MS_MAX },
  startupLowWaterMs: { min: BROWSER_CLOCK_WATER_MS_MIN, max: BROWSER_CLOCK_WATER_MS_MAX },
  startupHighWaterMs: { min: BROWSER_CLOCK_WATER_MS_MIN, max: BROWSER_CLOCK_WATER_MS_MAX },
  underrunRecoveryBoostMs: { min: BROWSER_CLOCK_BOOST_MS_MIN, max: BROWSER_CLOCK_BOOST_MS_MAX },
  maxUnderrunBoostMs: { min: BROWSER_CLOCK_BOOST_MS_MIN, max: BROWSER_CLOCK_BOOST_MS_MAX },
  maxBlocksPerRequest: { min: BROWSER_CLOCK_MAX_BLOCKS_MIN, max: BROWSER_CLOCK_MAX_BLOCKS_MAX },
  steadyMaxParallelRequests: { min: BROWSER_CLOCK_PARALLEL_REQUESTS_MIN, max: BROWSER_CLOCK_PARALLEL_REQUESTS_MAX },
  startupMaxParallelRequests: { min: BROWSER_CLOCK_PARALLEL_REQUESTS_MIN, max: BROWSER_CLOCK_PARALLEL_REQUESTS_MAX },
  recoveryMaxParallelRequests: {
    min: BROWSER_CLOCK_PARALLEL_REQUESTS_MIN,
    max: BROWSER_CLOCK_PARALLEL_REQUESTS_MAX
  },
  immediateRenderBlocks: {
    min: BROWSER_CLOCK_IMMEDIATE_RENDER_BLOCKS_MIN,
    max: BROWSER_CLOCK_IMMEDIATE_RENDER_BLOCKS_MAX
  },
  immediateRenderCooldownMs: {
    min: BROWSER_CLOCK_IMMEDIATE_COOLDOWN_MS_MIN,
    max: BROWSER_CLOCK_IMMEDIATE_COOLDOWN_MS_MAX
  }
};

interface ConfigPageProps {
  guiLanguage: GuiLanguage;
  audioRate: number;
  controlRate: number;
  ksmps: number;
  softwareBuffer: number;
  hardwareBuffer: number;
  showBrowserClockLatencyConfig: boolean;
  browserClockLatencySettings: BrowserClockLatencySettings;
  onHelpRequest?: (helpDocId: HelpDocId) => void;
  onApplyEngineConfig: (config: {
    sr: number;
    controlRate: number;
    softwareBuffer: number;
    hardwareBuffer: number;
  }) => void | Promise<void>;
  onApplyBrowserClockLatencySettings: (settings: BrowserClockLatencySettings) => void | Promise<void>;
}

function parsePositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function validateRange(
  value: number | null,
  min: number,
  max: number,
  label: string,
  copy: Pick<ConfigPageCopy, "integerValidation" | "rangeValidation">
): string | null {
  if (value === null) {
    return copy.integerValidation(label);
  }
  if (value < min || value > max) {
    return copy.rangeValidation(label, min, max);
  }
  return null;
}

function createLatencyFormState(settings: BrowserClockLatencySettings): BrowserClockLatencyFormState {
  return {
    steadyLowWaterMs: String(settings.steadyLowWaterMs),
    steadyHighWaterMs: String(settings.steadyHighWaterMs),
    startupLowWaterMs: String(settings.startupLowWaterMs),
    startupHighWaterMs: String(settings.startupHighWaterMs),
    underrunRecoveryBoostMs: String(settings.underrunRecoveryBoostMs),
    maxUnderrunBoostMs: String(settings.maxUnderrunBoostMs),
    maxBlocksPerRequest: String(settings.maxBlocksPerRequest),
    steadyMaxParallelRequests: String(settings.steadyMaxParallelRequests),
    startupMaxParallelRequests: String(settings.startupMaxParallelRequests),
    recoveryMaxParallelRequests: String(settings.recoveryMaxParallelRequests),
    immediateRenderBlocks: String(settings.immediateRenderBlocks),
    immediateRenderCooldownMs: String(settings.immediateRenderCooldownMs)
  };
}

function createEngineInputState(
  audioRate: number,
  controlRate: number,
  softwareBuffer: number,
  hardwareBuffer: number
): EngineInputState {
  return {
    audioRate: String(audioRate),
    controlRate: String(controlRate),
    softwareBuffer: String(softwareBuffer),
    hardwareBuffer: String(hardwareBuffer)
  };
}

export function ConfigPage({
  guiLanguage,
  audioRate,
  controlRate,
  ksmps,
  softwareBuffer,
  hardwareBuffer,
  showBrowserClockLatencyConfig,
  browserClockLatencySettings,
  onHelpRequest,
  onApplyEngineConfig,
  onApplyBrowserClockLatencySettings
}: ConfigPageProps) {
  const copy = CONFIG_PAGE_COPY[guiLanguage];

  const [engineInputs, setEngineInputs] = useState<EngineInputState>(() =>
    createEngineInputState(audioRate, controlRate, softwareBuffer, hardwareBuffer)
  );
  const [latencyInputs, setLatencyInputs] = useState<BrowserClockLatencyFormState>(() =>
    createLatencyFormState(browserClockLatencySettings)
  );

  useEffect(() => {
    setEngineInputs(createEngineInputState(audioRate, controlRate, softwareBuffer, hardwareBuffer));
  }, [audioRate, controlRate, hardwareBuffer, softwareBuffer]);

  useEffect(() => {
    setLatencyInputs(createLatencyFormState(browserClockLatencySettings));
  }, [browserClockLatencySettings]);

  const parsedAudioRate = parsePositiveInteger(engineInputs.audioRate);
  const parsedControlRate = parsePositiveInteger(engineInputs.controlRate);
  const parsedSoftwareBuffer = parsePositiveInteger(engineInputs.softwareBuffer);
  const parsedHardwareBuffer = parsePositiveInteger(engineInputs.hardwareBuffer);

  const audioError = validateRange(parsedAudioRate, AUDIO_RATE_MIN, AUDIO_RATE_MAX, copy.audioSampleRateHz, copy);
  const controlError = validateRange(
    parsedControlRate,
    CONTROL_RATE_MIN,
    CONTROL_RATE_MAX,
    copy.controlSampleRateHz,
    copy
  );
  const softwareBufferError = validateRange(
    parsedSoftwareBuffer,
    ENGINE_BUFFER_MIN,
    ENGINE_BUFFER_MAX,
    copy.softwareBuffer,
    copy
  );
  const hardwareBufferError = validateRange(
    parsedHardwareBuffer,
    ENGINE_BUFFER_MIN,
    ENGINE_BUFFER_MAX,
    copy.hardwareBuffer,
    copy
  );

  const canApply =
    audioError === null &&
    controlError === null &&
    softwareBufferError === null &&
    hardwareBufferError === null &&
    parsedAudioRate !== null &&
    parsedControlRate !== null &&
    parsedSoftwareBuffer !== null &&
    parsedHardwareBuffer !== null;

  const previewKsmps = useMemo(() => {
    if (!canApply || parsedAudioRate === null || parsedControlRate === null) {
      return Math.max(1, ksmps);
    }
    return Math.max(1, Math.round(parsedAudioRate / parsedControlRate));
  }, [canApply, ksmps, parsedAudioRate, parsedControlRate]);

  const previewActualControlRate = useMemo(() => {
    if (!canApply || parsedAudioRate === null) {
      return Math.round(audioRate / Math.max(1, ksmps));
    }
    return Math.round(parsedAudioRate / Math.max(1, previewKsmps));
  }, [audioRate, canApply, ksmps, parsedAudioRate, previewKsmps]);

  const browserClockFieldDefinitions = useMemo(
    () =>
      (Object.keys(BROWSER_CLOCK_FIELD_RANGES) as BrowserClockLatencyFieldKey[]).map((key) => ({
        key,
        label: copy.browserClockFields[key],
        min: BROWSER_CLOCK_FIELD_RANGES[key].min,
        max: BROWSER_CLOCK_FIELD_RANGES[key].max
      })),
    [copy]
  );

  const parsedLatencyValues = useMemo(
    () => {
      const result = {} as Record<BrowserClockLatencyFieldKey, number | null>;
      for (const field of browserClockFieldDefinitions) {
        result[field.key] = parsePositiveInteger(latencyInputs[field.key]);
      }
      return result;
    },
    [browserClockFieldDefinitions, latencyInputs]
  );

  const latencyErrors = useMemo(() => {
    const nextErrors = {} as Record<BrowserClockLatencyFieldKey, string | null>;
    for (const field of browserClockFieldDefinitions) {
      nextErrors[field.key] = validateRange(parsedLatencyValues[field.key], field.min, field.max, field.label, copy);
    }

    if (
      nextErrors.steadyHighWaterMs === null &&
      parsedLatencyValues.steadyHighWaterMs !== null &&
      parsedLatencyValues.steadyLowWaterMs !== null &&
      parsedLatencyValues.steadyHighWaterMs <= parsedLatencyValues.steadyLowWaterMs
    ) {
      nextErrors.steadyHighWaterMs = copy.greaterThanValidation(
        copy.browserClockFields.steadyHighWaterMs,
        copy.browserClockFields.steadyLowWaterMs
      );
    }

    if (
      nextErrors.startupHighWaterMs === null &&
      parsedLatencyValues.startupHighWaterMs !== null &&
      parsedLatencyValues.startupLowWaterMs !== null &&
      parsedLatencyValues.startupHighWaterMs <= parsedLatencyValues.startupLowWaterMs
    ) {
      nextErrors.startupHighWaterMs = copy.greaterThanValidation(
        copy.browserClockFields.startupHighWaterMs,
        copy.browserClockFields.startupLowWaterMs
      );
    }

    return nextErrors;
  }, [browserClockFieldDefinitions, copy, parsedLatencyValues]);

  const canApplyBrowserClockLatencySettings =
    browserClockFieldDefinitions.every((field) => latencyErrors[field.key] === null) &&
    browserClockFieldDefinitions.every((field) => parsedLatencyValues[field.key] !== null);

  const onApply = () => {
    if (
      !canApply ||
      parsedAudioRate === null ||
      parsedControlRate === null ||
      parsedSoftwareBuffer === null ||
      parsedHardwareBuffer === null
    ) {
      return;
    }

    void onApplyEngineConfig({
      sr: parsedAudioRate,
      controlRate: parsedControlRate,
      softwareBuffer: parsedSoftwareBuffer,
      hardwareBuffer: parsedHardwareBuffer
    });
  };

  function updateEngineInput(field: EngineInputFieldKey, value: string): void {
    setEngineInputs((current) => ({
      ...current,
      [field]: value
    }));
  }

  const onApplyBrowserClockLatency = () => {
    if (!canApplyBrowserClockLatencySettings) {
      return;
    }

    void onApplyBrowserClockLatencySettings({
      steadyLowWaterMs: parsedLatencyValues.steadyLowWaterMs ?? browserClockLatencySettings.steadyLowWaterMs,
      steadyHighWaterMs: parsedLatencyValues.steadyHighWaterMs ?? browserClockLatencySettings.steadyHighWaterMs,
      startupLowWaterMs: parsedLatencyValues.startupLowWaterMs ?? browserClockLatencySettings.startupLowWaterMs,
      startupHighWaterMs: parsedLatencyValues.startupHighWaterMs ?? browserClockLatencySettings.startupHighWaterMs,
      underrunRecoveryBoostMs:
        parsedLatencyValues.underrunRecoveryBoostMs ?? browserClockLatencySettings.underrunRecoveryBoostMs,
      maxUnderrunBoostMs: parsedLatencyValues.maxUnderrunBoostMs ?? browserClockLatencySettings.maxUnderrunBoostMs,
      maxBlocksPerRequest: parsedLatencyValues.maxBlocksPerRequest ?? browserClockLatencySettings.maxBlocksPerRequest,
      steadyMaxParallelRequests:
        parsedLatencyValues.steadyMaxParallelRequests ?? browserClockLatencySettings.steadyMaxParallelRequests,
      startupMaxParallelRequests:
        parsedLatencyValues.startupMaxParallelRequests ?? browserClockLatencySettings.startupMaxParallelRequests,
      recoveryMaxParallelRequests:
        parsedLatencyValues.recoveryMaxParallelRequests ?? browserClockLatencySettings.recoveryMaxParallelRequests,
      immediateRenderBlocks:
        parsedLatencyValues.immediateRenderBlocks ?? browserClockLatencySettings.immediateRenderBlocks,
      immediateRenderCooldownMs:
        parsedLatencyValues.immediateRenderCooldownMs ?? browserClockLatencySettings.immediateRenderCooldownMs
    });
  };

  return (
    <main className="grid gap-4 lg:grid-cols-[minmax(0,_700px)_minmax(0,_1fr)]">
      <div className="grid gap-4">
        <section className="relative rounded-2xl border border-slate-700/70 bg-slate-900/75 p-5">
          {onHelpRequest ? (
            <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("config_audio_engine")} />
          ) : null}
          <h2 className="font-display text-lg font-semibold tracking-tight text-slate-100">
            {copy.audioEngineConfiguration}
          </h2>
          <p className="mt-1 text-sm text-slate-400">{copy.audioEngineDescription}</p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-slate-400">{copy.audioSampleRateHz}</span>
              <input
                type="number"
                inputMode="numeric"
                min={AUDIO_RATE_MIN}
                max={AUDIO_RATE_MAX}
                step={1}
                value={engineInputs.audioRate}
                onChange={(event) => updateEngineInput("audioRate", event.target.value)}
                className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
              />
              <span className={`text-xs ${audioError ? "text-rose-300" : "text-slate-500"}`}>
                {audioError ?? copy.allowedRange(AUDIO_RATE_MIN, AUDIO_RATE_MAX)}
              </span>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-slate-400">{copy.controlSampleRateHz}</span>
              <input
                type="number"
                inputMode="numeric"
                min={CONTROL_RATE_MIN}
                max={CONTROL_RATE_MAX}
                step={1}
                value={engineInputs.controlRate}
                onChange={(event) => updateEngineInput("controlRate", event.target.value)}
                className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
              />
              <span className={`text-xs ${controlError ? "text-rose-300" : "text-slate-500"}`}>
                {controlError ?? copy.allowedRange(CONTROL_RATE_MIN, CONTROL_RATE_MAX)}
              </span>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-slate-400">{copy.softwareBuffer}</span>
              <input
                type="number"
                inputMode="numeric"
                min={ENGINE_BUFFER_MIN}
                max={ENGINE_BUFFER_MAX}
                step={1}
                value={engineInputs.softwareBuffer}
                onChange={(event) => updateEngineInput("softwareBuffer", event.target.value)}
                className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
              />
              <span className={`text-xs ${softwareBufferError ? "text-rose-300" : "text-slate-500"}`}>
                {softwareBufferError ?? copy.allowedRange(ENGINE_BUFFER_MIN, ENGINE_BUFFER_MAX)}
              </span>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-slate-400">{copy.hardwareBuffer}</span>
              <input
                type="number"
                inputMode="numeric"
                min={ENGINE_BUFFER_MIN}
                max={ENGINE_BUFFER_MAX}
                step={1}
                value={engineInputs.hardwareBuffer}
                onChange={(event) => updateEngineInput("hardwareBuffer", event.target.value)}
                className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
              />
              <span className={`text-xs ${hardwareBufferError ? "text-rose-300" : "text-slate-500"}`}>
                {hardwareBufferError ?? copy.allowedRange(ENGINE_BUFFER_MIN, ENGINE_BUFFER_MAX)}
              </span>
            </label>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onApply}
              disabled={!canApply}
              className="rounded-lg border border-accent/60 bg-accent/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent transition enabled:hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copy.applyConfiguration}
            </button>
            <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 font-mono text-xs text-slate-300">
              {copy.derivedKsmps}: {previewKsmps}
            </span>
            <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 font-mono text-xs text-slate-300">
              {copy.actualControlRate}: {previewActualControlRate}
            </span>
          </div>
        </section>

        {showBrowserClockLatencyConfig ? (
          <section className="relative rounded-2xl border border-slate-700/70 bg-slate-900/65 p-5">
            {onHelpRequest ? (
              <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("config_browser_clock_latency")} />
            ) : null}
            <h3 className="font-display text-base font-semibold text-slate-100">
              {copy.browserClockLatencyConfiguration}
            </h3>
            <p className="mt-1 text-sm text-slate-400">{copy.browserClockLatencyDescription}</p>
            <p className="mt-2 text-xs text-slate-500">{copy.browserClockLatencyStorageNote}</p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {browserClockFieldDefinitions.map((field) => (
                <label key={field.key} className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-400">{field.label}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={field.min}
                    max={field.max}
                    step={1}
                    value={latencyInputs[field.key]}
                    onChange={(event) =>
                      setLatencyInputs((current) => ({
                        ...current,
                        [field.key]: event.target.value
                      }))
                    }
                    className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
                  />
                  <span className={`text-xs ${latencyErrors[field.key] ? "text-rose-300" : "text-slate-500"}`}>
                    {latencyErrors[field.key] ?? copy.allowedRange(field.min, field.max)}
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onApplyBrowserClockLatency}
                disabled={!canApplyBrowserClockLatencySettings}
                className="rounded-lg border border-accent/60 bg-accent/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent transition enabled:hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {copy.applyBrowserClockLatencyConfiguration}
              </button>
            </div>
          </section>
        ) : null}
      </div>

      <aside className="relative rounded-2xl border border-slate-700/70 bg-slate-900/55 p-5">
        {onHelpRequest ? (
          <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("config_engine_values")} />
        ) : null}
        <h3 className="font-display text-base font-semibold text-slate-100">{copy.currentPatchEngineValues}</h3>
        <dl className="mt-4 space-y-2 text-sm text-slate-300">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2">
            <dt>sr</dt>
            <dd className="font-mono">{audioRate}</dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2">
            <dt>{copy.controlRateTarget}</dt>
            <dd className="font-mono">{controlRate}</dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2">
            <dt>ksmps</dt>
            <dd className="font-mono">{ksmps}</dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2">
            <dt>{copy.softwareBufferMetric}</dt>
            <dd className="font-mono">{softwareBuffer}</dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2">
            <dt>{copy.hardwareBufferMetric}</dt>
            <dd className="font-mono">{hardwareBuffer}</dd>
          </div>
        </dl>
      </aside>
    </main>
  );
}
