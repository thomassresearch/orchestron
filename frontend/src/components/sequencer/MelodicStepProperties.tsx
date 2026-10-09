import { useEffect, useRef, useState } from "react";
import type { GuiLanguage, SequencerStepState, SequencerTimingConfig, StrumDirection } from "../../types";
import { timingOffsetMilliseconds } from "../../lib/sequencer";
import { normalizeStrumSpread } from "../../lib/sequencerStrum";
import { NoteTimingControl, noteTimingCopy } from "./NoteTimingControl";

export const melodicStepCopy = {
  english: { properties: "Step properties", close: "Close step properties", strum: "Strum", off: "Off", up: "Low → High", down: "High → Low", spread: "Spread", reset: "Reset spread", requires: "Select a chord to enable strumming.", hint: "Right-click or Shift+F10: timing and strum.", help: "Spread is the time from first to last note, as a percentage of one local step. At 100%, the last note starts at the next step. Every note retains its duration and may overlap later steps." },
  german: { properties: "Schritteigenschaften", close: "Schritteigenschaften schließen", strum: "Akkordanschlag", off: "Aus", up: "Tief → Hoch", down: "Hoch → Tief", spread: "Spreizung", reset: "Spreizung zurücksetzen", requires: "Wählen Sie einen Akkord, um den versetzten Anschlag zu aktivieren.", hint: "Rechtsklick oder Umschalt+F10: Timing und Akkordanschlag.", help: "Spreizung ist die Zeit von der ersten bis zur letzten Note in Prozent eines lokalen Schritts. Bei 100% beginnt die letzte Note am nächsten Schritt. Jede Note behält ihre Dauer und kann spätere Schritte überlappen." },
  french: { properties: "Propriétés du pas", close: "Fermer les propriétés du pas", strum: "Accord égrené", off: "Désactivé", up: "Grave → Aigu", down: "Aigu → Grave", spread: "Étalement", reset: "Réinitialiser l’étalement", requires: "Sélectionnez un accord pour activer l’égrènement.", hint: "Clic droit ou Maj+F10 : placement et accord égrené.", help: "L’étalement est le temps entre la première et la dernière note, en pourcentage d’un pas local. À 100%, la dernière note commence au pas suivant. Chaque note conserve sa durée et peut chevaucher les pas suivants." },
  spanish: { properties: "Propiedades del paso", close: "Cerrar propiedades del paso", strum: "Rasgueo", off: "Desactivado", up: "Grave → Agudo", down: "Agudo → Grave", spread: "Separación", reset: "Restablecer separación", requires: "Selecciona un acorde para activar el rasgueo.", hint: "Clic derecho o Mayús+F10: tiempo y rasgueo.", help: "La separación es el tiempo entre la primera y la última nota, como porcentaje de un paso local. Al 100%, la última nota empieza en el paso siguiente. Cada nota conserva su duración y puede solaparse con pasos posteriores." }
} satisfies Record<GuiLanguage, Record<string, string>>;

export function MelodicStepProperties({ step, index, label, timing, language, onTiming, onStrum, onClose }: {
  step: SequencerStepState; index: number; label: string; timing: SequencerTimingConfig; language: GuiLanguage;
  onTiming: (value: number) => void; onStrum: (direction: StrumDirection, spread: number) => void; onClose: () => void;
}) {
  const copy = melodicStepCopy[language];
  const direction = step.strumDirection ?? "off", spread = step.strumSpreadPercent ?? 0;
  const chord = step.note !== null && step.chord !== "none";
  const disabled = !chord || direction === "off";
  const [draft, setDraft] = useState(String(spread));
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(String(spread)), [spread]);
  useEffect(() => { panel.current?.focus(); }, []);
  const description = `${spread}% (${timingOffsetMilliseconds(spread, timing).toFixed(1)} ms)`;
  return <div ref={panel} tabIndex={-1} role="group" aria-label={copy.properties}
    className="rounded-md border border-cyan-700/70 bg-slate-900/70 p-3 outline-none"
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-200">
      <span>{noteTimingCopy[language].step} {index + 1} · {label}</span>
      <button type="button" className="ml-auto rounded px-2 hover:bg-slate-700" onClick={onClose} aria-label={copy.close}>×</button>
    </div>
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
      <div className="w-48"><NoteTimingControl value={step.timingOffsetPercent ?? 0} timing={timing} language={language} onChange={onTiming} /></div>
      <div className="min-w-0 flex-1 text-xs text-slate-300">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">{copy.strum}
            <select value={direction} disabled={!chord} onChange={event => onStrum(event.target.value as StrumDirection, spread)}
              className="rounded border border-slate-600 bg-slate-950 px-2 py-1 disabled:opacity-40">
              {(["off", "up", "down"] as const).map(value => <option key={value} value={value}>{copy[value]}</option>)}
            </select>
          </label>
          <label className={`flex items-center gap-2 ${disabled ? "opacity-40" : ""}`}>{copy.spread}
            <input type="range" min={0} max={100} step={1} value={spread} disabled={disabled} aria-label={copy.spread}
              aria-valuetext={description} className="w-28 accent-cyan-400" onChange={event => onStrum(direction, Number(event.target.value))} />
            <input type="number" min={0} max={100} step={1} value={draft} disabled={disabled} aria-label={`${copy.spread} (%)`}
              className="w-14 rounded border border-slate-600 bg-slate-950 px-1 py-0.5" onBlur={() => setDraft(String(spread))}
              onChange={event => { setDraft(event.target.value); if (event.target.value !== "") onStrum(direction, normalizeStrumSpread(Number(event.target.value))); }} />%
          </label>
          <button type="button" disabled={disabled} onClick={() => onStrum(direction, 0)} aria-label={copy.reset} title={copy.reset} className="disabled:opacity-40">↺</button>
          <span className="text-slate-400">{timingOffsetMilliseconds(spread, timing).toFixed(1)} ms</span>
        </div>
        <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-slate-400">{chord ? copy.help : copy.requires}</p>
      </div>
    </div>
  </div>;
}
