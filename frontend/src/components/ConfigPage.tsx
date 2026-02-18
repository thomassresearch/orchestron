import { useEffect, useMemo, useState } from "react";

const AUDIO_RATE_MIN = 22000;
const AUDIO_RATE_MAX = 48000;
const CONTROL_RATE_MIN = 25;
const CONTROL_RATE_MAX = 48000;

interface ConfigPageProps {
  audioRate: number;
  controlRate: number;
  ksmps: number;
  onAudioRateChange: (value: number) => void;
  onControlRateChange: (value: number) => void;
}

function parsePositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function validateRange(value: number | null, min: number, max: number, label: string): string | null {
  if (value === null) {
    return `${label} must be an integer.`;
  }
  if (value < min || value > max) {
    return `${label} must be between ${min} and ${max}.`;
  }
  return null;
}

export function ConfigPage({
  audioRate,
  controlRate,
  ksmps,
  onAudioRateChange,
  onControlRateChange
}: ConfigPageProps) {
  const [audioInput, setAudioInput] = useState(String(audioRate));
  const [controlInput, setControlInput] = useState(String(controlRate));

  useEffect(() => {
    setAudioInput(String(audioRate));
  }, [audioRate]);

  useEffect(() => {
    setControlInput(String(controlRate));
  }, [controlRate]);

  const parsedAudioRate = parsePositiveInteger(audioInput);
  const parsedControlRate = parsePositiveInteger(controlInput);

  const audioError = validateRange(parsedAudioRate, AUDIO_RATE_MIN, AUDIO_RATE_MAX, "Audio sample rate");
  const controlError = validateRange(parsedControlRate, CONTROL_RATE_MIN, CONTROL_RATE_MAX, "Control sample rate");

  const canApply = audioError === null && controlError === null && parsedAudioRate !== null && parsedControlRate !== null;

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
    if (!canApply || parsedAudioRate === null || parsedControlRate === null) {
      return;
    }

    onAudioRateChange(parsedAudioRate);
    onControlRateChange(parsedControlRate);
  };

  return (
    <main className="grid gap-4 lg:grid-cols-[minmax(0,_700px)_minmax(0,_1fr)]">
      <section className="rounded-2xl border border-slate-700/70 bg-slate-900/75 p-5">
        <h2 className="font-display text-lg font-semibold tracking-tight text-slate-100">Audio Engine Configuration</h2>
        <p className="mt-1 text-sm text-slate-400">
          Configure audio-rate (`sr`) and target control-rate sampling. VisualCSound derives `ksmps` from both values.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-slate-400">Audio Sample Rate (Hz)</span>
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
              {audioError ?? `Allowed: ${AUDIO_RATE_MIN} - ${AUDIO_RATE_MAX}`}
            </span>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-slate-400">Control Sample Rate (Hz)</span>
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
              {controlError ?? `Allowed: ${CONTROL_RATE_MIN} - ${CONTROL_RATE_MAX}`}
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
            Apply Configuration
          </button>
          <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 font-mono text-xs text-slate-300">
            Derived `ksmps`: {previewKsmps}
          </span>
          <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 font-mono text-xs text-slate-300">
            Actual control rate (`sr/ksmps`): {previewActualControlRate}
          </span>
        </div>
      </section>

      <aside className="rounded-2xl border border-slate-700/70 bg-slate-900/55 p-5">
        <h3 className="font-display text-base font-semibold text-slate-100">Current Patch Engine Values</h3>
        <dl className="mt-4 space-y-2 text-sm text-slate-300">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2">
            <dt>sr</dt>
            <dd className="font-mono">{audioRate}</dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2">
            <dt>control_rate (target)</dt>
            <dd className="font-mono">{controlRate}</dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2">
            <dt>ksmps</dt>
            <dd className="font-mono">{ksmps}</dd>
          </div>
        </dl>
      </aside>
    </main>
  );
}
