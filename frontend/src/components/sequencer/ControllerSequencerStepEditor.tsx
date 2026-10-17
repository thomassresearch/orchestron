import { memo, useEffect } from "react";
import type { ControllerSequencerState, GuiLanguage } from "../../types";
import { sequencerTransportSubunitsPerLocalStep } from "../../lib/sequencer";
import { sequencerStepBoundary } from "../../lib/sequencerTimingPresentation";
import { BeatGroupHeaders } from "./SequencerTimingControls";
import { RetainedScroll, usePerformanceEditorState } from "./PerformanceEditorState";

export const controllerModeCopy = {
  english: { mode: "Controller mode", curve: "Curve Mode", step: "Step Mode", reset: "Reset Value", cell: "Step", empty: "Empty", hint: "0–127 · Blank sends nothing · Enter or leave the cell to apply · Escape cancels", resetHint: "Sent on start, stop and seek, on this CC and its selected channels." },
  german: { mode: "Controller-Modus", curve: "Kurvenmodus", step: "Schrittmodus", reset: "Rücksetzwert", cell: "Schritt", empty: "Leer", hint: "0–127 · Leer sendet nichts · Enter oder Verlassen übernimmt · Escape verwirft", resetHint: "Wird bei Start, Stopp und Sprüngen für diesen CC auf den gewählten Kanälen gesendet." },
  french: { mode: "Mode du contrôleur", curve: "Mode courbe", step: "Mode pas", reset: "Valeur de réinitialisation", cell: "Pas", empty: "Vide", hint: "0–127 · Vide n’envoie rien · Entrée ou quitter la cellule pour appliquer · Échap annule", resetHint: "Envoyée au démarrage, à l’arrêt et lors des déplacements, pour ce CC sur les canaux sélectionnés." },
  spanish: { mode: "Modo del controlador", curve: "Modo curva", step: "Modo pasos", reset: "Valor de reinicio", cell: "Paso", empty: "Vacío", hint: "0–127 · Vacío no envía nada · Enter o salir de la celda aplica · Escape cancela", resetHint: "Se envía al iniciar, detener y saltar, para este CC en los canales seleccionados." }
};

function StepCell({ id, pad, step, value, language, current, onChange }: {
  id: string; pad: number; step: number; value: number | null; language: GuiLanguage; current: boolean;
  onChange: (step: number, value: number | null) => void;
}) {
  const copy = controllerModeCopy[language];
  const [draft, setDraft] = usePerformanceEditorState<{ text: string; original: number | null } | null>(
    `device:${id}`, `controllerStepDraft:${pad}:${step}`, null);
  useEffect(() => { if (draft && draft.original !== value) setDraft(null); }, [draft, value, setDraft]);
  const text = draft?.original === value ? draft.text : value === null ? "" : String(value);
  const commit = () => {
    if (!draft || draft.original !== value) return;
    if (text.trim() === "") onChange(step, null);
    else if (/^\d{1,3}$/.test(text.trim()) && Number(text) <= 127) onChange(step, Number(text));
    setDraft(null);
  };
  return <input type="text" inputMode="numeric" value={text} placeholder="—"
    aria-label={`${copy.cell} ${step + 1}`} aria-current={current ? "step" : undefined}
    title={`${copy.cell} ${step + 1}: ${value ?? copy.empty}. ${copy.hint}`}
    onChange={event => setDraft({ text: event.target.value, original: value })}
    onBlur={commit} onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === "Escape") { event.preventDefault(); setDraft(null); }
    }}
    className={`h-10 min-w-0 rounded-md border text-center font-mono text-sm outline-none focus:ring-2 focus:ring-accent ${
      current ? "border-emerald-400 bg-emerald-400/15 text-emerald-100" : value !== null
        ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-100" : "border-slate-700 bg-slate-950/70 text-slate-200"}`} />;
}

export const ControllerSequencerStepEditor = memo(function ControllerSequencerStepEditor({ track, language, transportSubunit, onChange }: {
  track: ControllerSequencerState; language: GuiLanguage; transportSubunit: number | null;
  onChange: (step: number, value: number | null) => void;
}) {
  const stepDuration = sequencerTransportSubunitsPerLocalStep(track.timing);
  const offset = (transportSubunit ?? 0) - (track.runtimePadStartSubunit ?? 0);
  const current = transportSubunit === null ? -1 : ((Math.floor(offset / stepDuration) % track.stepCount) + track.stepCount) % track.stepCount;
  return <div className="space-y-2">
    <p className="text-xs text-slate-400">{controllerModeCopy[language].hint}</p>
    <RetainedScroll owner={`device:${track.id}`} field="controllerStepGrid" className="overflow-x-auto pb-2">
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${track.stepCount}, minmax(44px, 1fr))`, minWidth: track.stepCount * 48 }}>
        <BeatGroupHeaders timing={track.timing} stepCount={track.stepCount} language={language} />
        {Array.from({ length: track.stepCount }, (_, step) => <div key={`header-${step}`}
          className={`rounded border border-slate-700 py-1 text-center font-mono text-[10px] ${current === step ? "bg-emerald-400/15 text-emerald-200" : "text-slate-400"}`}
          style={{ borderLeftWidth: sequencerStepBoundary(track.timing, step).barStart ? 3 : sequencerStepBoundary(track.timing, step).beatStart ? 2 : 1 }}>
          {step + 1}
        </div>)}
        {Array.from({ length: track.stepCount }, (_, step) => <StepCell key={`${track.activePad}:${step}`}
          id={track.id} pad={track.activePad} step={step} language={language} current={current === step}
          value={track.pads[track.activePad]?.steps?.[step] ?? null} onChange={onChange} />)}
      </div>
    </RetainedScroll>
  </div>;
});
