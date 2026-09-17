import { useEffect, useState } from "react";
import type { GuiLanguage, SequencerTimingConfig } from "../../types";
import { normalizeTimingOffset, timingOffsetMilliseconds } from "../../lib/sequencer";

export const noteTimingCopy = {
  english: { step: "Step", key: "Key", timing: "Timing", early: "Early", late: "Late", onGrid: "On grid", reset: "Reset timing", close: "Close timing", drumHint: "Drag left/right: timing; up/down: velocity. Right-click: timing controls. Arrow keys: adjust." },
  german: { step: "Schritt", key: "Taste", timing: "Timing", early: "Früh", late: "Spät", onGrid: "Im Raster", reset: "Timing zurücksetzen", close: "Timing schließen", drumHint: "Links/rechts ziehen: Timing; hoch/runter: Anschlagstärke. Rechtsklick: Timing-Regler. Pfeiltasten: anpassen." },
  french: { step: "Pas", key: "Touche", timing: "Placement", early: "En avance", late: "En retard", onGrid: "Sur la grille", reset: "Réinitialiser le placement", close: "Fermer le placement", drumHint: "Glisser gauche/droite : placement ; haut/bas : vélocité. Clic droit : réglages. Flèches : ajuster." },
  spanish: { step: "Paso", key: "Tecla", timing: "Tiempo", early: "Adelantado", late: "Retrasado", onGrid: "En la cuadrícula", reset: "Restablecer tiempo", close: "Cerrar tiempo", drumHint: "Arrastrar izquierda/derecha: tiempo; arriba/abajo: velocidad. Clic derecho: controles. Flechas: ajustar." }
} satisfies Record<GuiLanguage, { step: string; key: string; timing: string; early: string; late: string; onGrid: string; reset: string; close: string; drumHint: string }>;

export function timingDescription(value: number, timing: SequencerTimingConfig, language: GuiLanguage): string {
  const copy = noteTimingCopy[language];
  if (value === 0) return copy.onGrid;
  return `${value < 0 ? copy.early : copy.late}: ${value > 0 ? "+" : ""}${value}% (${timingOffsetMilliseconds(value, timing).toFixed(1)} ms)`;
}

export function NoteTimingControl({ value, timing, language, onChange }: {
  value: number; timing: SequencerTimingConfig; language: GuiLanguage; onChange: (value: number) => void;
}) {
  const copy = noteTimingCopy[language];
  const description = timingDescription(value, timing, language);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <div className="mb-1 min-w-0 text-[10px] text-slate-300" title={description}>
    <div className="flex items-center gap-0.5 tracking-normal">
      <span className="min-w-0 flex-1 truncate text-[9px]">{copy.timing}</span>
      <input type="number" min={-50} max={50} step={1} value={draft} aria-label={`${copy.timing} (%)`}
        className="w-9 shrink-0 appearance-none rounded border border-slate-600 bg-slate-950 px-0.5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        onBlur={() => setDraft(String(value))}
        onChange={event => {
          setDraft(event.target.value);
          if (event.target.value !== "") onChange(normalizeTimingOffset(Number(event.target.value)));
        }} />
      <span>%</span>
      <button type="button" className="shrink-0 px-0.5" onClick={() => onChange(0)} aria-label={copy.reset} title={copy.reset}>↺</button>
    </div>
    <input type="range" min={-50} max={50} step={1} value={value} aria-label={copy.timing} aria-valuetext={description}
      className="block h-3 w-full accent-cyan-400" onChange={event => onChange(Number(event.target.value))} />
    <div className="text-[9px] text-slate-400">{description}</div>
  </div>;
}
