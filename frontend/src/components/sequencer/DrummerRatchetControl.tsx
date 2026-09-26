import { useEffect, useState } from "react";
import type { DrummerSequencerCellState, GuiLanguage } from "../../types";

export const drummerRatchetCopy = {
  english: { properties: "Step properties", close: "Close step properties", ratchets: "Ratchets", ramp: "Velocity ramp", final: "Final velocity", velocity: "Velocity", key: "Drum key", step: "Step", hint: "Right-click or Shift+F10: timing and ratchets.", help: "Evenly spaced hits within one step. Timing shifts the whole roll; the next active cell cuts it short. Final velocity 0 makes the last hit silent." },
  german: { properties: "Schritteigenschaften", close: "Schritteigenschaften schließen", ratchets: "Mehrfachanschläge", ramp: "Anschlagstärke-Verlauf", final: "Letzte Anschlagstärke", velocity: "Anschlagstärke", key: "Drum-Taste", step: "Schritt", hint: "Rechtsklick oder Umschalt+F10: Timing und Mehrfachanschläge.", help: "Gleichmäßig verteilte Anschläge in einem Schritt. Timing verschiebt den ganzen Wirbel; die nächste aktive Zelle beendet ihn. Letzte Anschlagstärke 0 lässt den letzten Anschlag verstummen." },
  french: { properties: "Propriétés du pas", close: "Fermer les propriétés du pas", ratchets: "Répétitions rapides", ramp: "Rampe de vélocité", final: "Vélocité finale", velocity: "Vélocité", key: "Note de batterie", step: "Pas", hint: "Clic droit ou Maj+F10 : placement et répétitions.", help: "Frappes régulièrement espacées sur un pas. Le placement décale tout le roulement ; la cellule active suivante l'interrompt. Une vélocité finale de 0 rend la dernière frappe silencieuse." },
  spanish: { properties: "Propiedades del paso", close: "Cerrar propiedades del paso", ratchets: "Repeticiones rápidas", ramp: "Rampa de velocidad", final: "Velocidad final", velocity: "Velocidad", key: "Nota de batería", step: "Paso", hint: "Clic derecho o Mayús+F10: tiempo y repeticiones.", help: "Golpes equidistantes dentro de un paso. El tiempo desplaza todo el redoble; la siguiente celda activa lo interrumpe. Una velocidad final de 0 silencia el último golpe." }
} satisfies Record<GuiLanguage, Record<string, string>>;

export function drummerCellDescription(cell: DrummerSequencerCellState, key: number, step: number, language: GuiLanguage): string {
  const copy = drummerRatchetCopy[language];
  // Retain the familiar English accessible name while translating the other locales.
  const prefix = language === "english" ? `Step ${step + 1}, drum key ${key}, velocity ${cell.velocity}`
    : `${copy.step} ${step + 1}, ${copy.key} ${key}, ${copy.velocity} ${cell.velocity}`;
  return `${prefix}, ${copy.ratchets}: ${cell.ratchets ?? 1}${cell.ratchetEndVelocity == null ? "" : `, ${copy.final}: ${cell.ratchetEndVelocity}`}`;
}

export function DrummerRatchetControl({ cell, language, onChange }: {
  cell: DrummerSequencerCellState; language: GuiLanguage;
  onChange: (count: number, endVelocity: number | null) => void;
}) {
  const copy = drummerRatchetCopy[language];
  const count = cell.ratchets ?? 1;
  const end = cell.ratchetEndVelocity ?? null;
  const [draft, setDraft] = useState(String(end ?? cell.velocity));
  useEffect(() => setDraft(String(end ?? cell.velocity)), [end, cell.velocity]);
  const fieldClass = "rounded border border-slate-600 bg-slate-950 px-1 py-0.5 disabled:opacity-40";
  return <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300" title={copy.help}>
    <label className="flex items-center gap-1">{copy.ratchets}
      <select aria-label={copy.ratchets} value={count} className={fieldClass}
        onChange={event => onChange(Number(event.target.value), end)}>
        {Array.from({ length: 8 }, (_, index) => <option key={index} value={index + 1}>×{index + 1}</option>)}
      </select>
    </label>
    <label className="flex items-center gap-1">
      <input type="checkbox" checked={end !== null} disabled={count === 1}
        onChange={event => onChange(count, event.target.checked ? cell.velocity : null)} />{copy.ramp}
    </label>
    <label className="flex items-center gap-1">{copy.final}
      <input type="number" min={0} max={127} step={1} aria-label={copy.final}
        className={`${fieldClass} w-14`} value={draft} disabled={count === 1 || end === null}
        onBlur={() => setDraft(String(end ?? cell.velocity))}
        onChange={event => {
          setDraft(event.target.value);
          if (event.target.value !== "" && Number.isFinite(Number(event.target.value))) {
            onChange(count, Math.max(0, Math.min(127, Math.round(Number(event.target.value)))));
          }
        }} />
    </label>
  </div>;
}
