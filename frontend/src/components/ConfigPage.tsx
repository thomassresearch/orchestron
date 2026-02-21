import { useEffect, useMemo, useState } from "react";

import { HelpIconButton } from "./HelpIconButton";
import type { GuiLanguage, HelpDocId } from "../types";

const AUDIO_RATE_MIN = 22000;
const AUDIO_RATE_MAX = 48000;
const CONTROL_RATE_MIN = 25;
const CONTROL_RATE_MAX = 48000;
const ENGINE_BUFFER_MIN = 32;
const ENGINE_BUFFER_MAX = 8192;

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
  integerValidation: (label: string) => string;
  rangeValidation: (label: string, min: number, max: number) => string;
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
    integerValidation: (label) => `${label} must be an integer.`,
    rangeValidation: (label, min, max) => `${label} must be between ${min} and ${max}.`,
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
    integerValidation: (label) => `${label} muss eine ganze Zahl sein.`,
    rangeValidation: (label, min, max) => `${label} muss zwischen ${min} und ${max} liegen.`,
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
    integerValidation: (label) => `${label} doit etre un entier.`,
    rangeValidation: (label, min, max) => `${label} doit etre entre ${min} et ${max}.`,
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
    integerValidation: (label) => `${label} debe ser un entero.`,
    rangeValidation: (label, min, max) => `${label} debe estar entre ${min} y ${max}.`,
    allowedRange: (min, max) => `Permitido: ${min} - ${max}`
  }
};

interface ConfigPageProps {
  guiLanguage: GuiLanguage;
  audioRate: number;
  controlRate: number;
  ksmps: number;
  softwareBuffer: number;
  hardwareBuffer: number;
  onHelpRequest?: (helpDocId: HelpDocId) => void;
  onApplyEngineConfig: (config: {
    sr: number;
    controlRate: number;
    softwareBuffer: number;
    hardwareBuffer: number;
  }) => void | Promise<void>;
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

export function ConfigPage({
  guiLanguage,
  audioRate,
  controlRate,
  ksmps,
  softwareBuffer,
  hardwareBuffer,
  onHelpRequest,
  onApplyEngineConfig
}: ConfigPageProps) {
  const copy = CONFIG_PAGE_COPY[guiLanguage];

  const [audioInput, setAudioInput] = useState(String(audioRate));
  const [controlInput, setControlInput] = useState(String(controlRate));
  const [softwareBufferInput, setSoftwareBufferInput] = useState(String(softwareBuffer));
  const [hardwareBufferInput, setHardwareBufferInput] = useState(String(hardwareBuffer));

  useEffect(() => {
    setAudioInput(String(audioRate));
  }, [audioRate]);

  useEffect(() => {
    setControlInput(String(controlRate));
  }, [controlRate]);

  useEffect(() => {
    setSoftwareBufferInput(String(softwareBuffer));
  }, [softwareBuffer]);

  useEffect(() => {
    setHardwareBufferInput(String(hardwareBuffer));
  }, [hardwareBuffer]);

  const parsedAudioRate = parsePositiveInteger(audioInput);
  const parsedControlRate = parsePositiveInteger(controlInput);
  const parsedSoftwareBuffer = parsePositiveInteger(softwareBufferInput);
  const parsedHardwareBuffer = parsePositiveInteger(hardwareBufferInput);

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

  return (
    <main className="grid gap-4 lg:grid-cols-[minmax(0,_700px)_minmax(0,_1fr)]">
      <section className="relative rounded-2xl border border-slate-700/70 bg-slate-900/75 p-5">
        {onHelpRequest ? (
          <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("config_audio_engine")} />
        ) : null}
        <h2 className="font-display text-lg font-semibold tracking-tight text-slate-100">{copy.audioEngineConfiguration}</h2>
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
              value={audioInput}
              onChange={(event) => setAudioInput(event.target.value)}
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
              value={controlInput}
              onChange={(event) => setControlInput(event.target.value)}
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
              value={softwareBufferInput}
              onChange={(event) => setSoftwareBufferInput(event.target.value)}
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
              value={hardwareBufferInput}
              onChange={(event) => setHardwareBufferInput(event.target.value)}
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
