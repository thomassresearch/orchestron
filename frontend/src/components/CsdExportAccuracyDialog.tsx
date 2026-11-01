import { useEffect, useId, useRef, useState } from "react";
import type { GuiLanguage } from "../types";
import { ModalFrame } from "./ModalFrame";

const COPY = {
  english: {
    title: "CSD export accuracy",
    description: "Choose how closely the exported controller curves follow the original.",
    label: "Maximum deviation", accurate: "More accurate", smaller: "Smaller file",
    help: "1 CC is the most accurate setting. Higher values reduce file size but can change the sound more. Step patterns and resets remain exact.",
    cancel: "Cancel", export: "Export CSD"
  },
  german: {
    title: "Genauigkeit des CSD-Exports",
    description: "Wähle, wie genau die exportierten Controller-Kurven dem Original folgen.",
    label: "Maximale Abweichung", accurate: "Genauer", smaller: "Kleinere Datei",
    help: "1 CC ist die genaueste Einstellung. Höhere Werte verkleinern die Datei, können den Klang aber stärker verändern. Step-Patterns und Rücksetzwerte bleiben exakt.",
    cancel: "Abbrechen", export: "CSD exportieren"
  },
  french: {
    title: "Précision de l’export CSD",
    description: "Choisissez la précision des courbes de contrôleur exportées par rapport à l’original.",
    label: "Écart maximal", accurate: "Plus précis", smaller: "Fichier plus petit",
    help: "1 CC est le réglage le plus précis. Les valeurs plus élevées réduisent la taille du fichier, mais peuvent modifier davantage le son. Les motifs Step et les réinitialisations restent exacts.",
    cancel: "Annuler", export: "Exporter CSD"
  },
  spanish: {
    title: "Precisión de exportación CSD",
    description: "Elige con qué precisión las curvas de controlador exportadas siguen el original.",
    label: "Desviación máxima", accurate: "Más preciso", smaller: "Archivo más pequeño",
    help: "1 CC es el ajuste más preciso. Los valores más altos reducen el tamaño del archivo, pero pueden cambiar más el sonido. Los patrones Step y los reinicios permanecen exactos.",
    cancel: "Cancelar", export: "Exportar CSD"
  }
} satisfies Record<GuiLanguage, Record<string, string>>;

export function CsdExportAccuracyDialog({ guiLanguage, onClose }: {
  guiLanguage: GuiLanguage;
  onClose: (tolerance: number | null) => void;
}) {
  const copy = COPY[guiLanguage];
  const id = useId();
  const [tolerance, setTolerance] = useState(1);
  const form = useRef<HTMLFormElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    slider.current?.focus();
    return () => previous?.focus();
  }, []);

  return <ModalFrame ariaLabel={copy.title} title={copy.title} subtitle={copy.description}
    maxWidthClassName="max-w-lg" onClose={() => onClose(null)} closeOnEscape>
    <form ref={form} onSubmit={event => { event.preventDefault(); onClose(tolerance); }} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = form.current?.querySelectorAll<HTMLElement>("input, button");
      const first = controls?.[0], last = controls?.[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-slate-100">{copy.label}</label>
        <output htmlFor={id} className="min-w-20 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-center font-mono text-lg text-cyan-200">{tolerance} CC</output>
      </div>
      <input ref={slider} id={id} type="range" min={1} max={10} step={1} value={tolerance}
        aria-describedby={`${id}-help`} aria-valuetext={`${tolerance} CC`}
        onChange={event => setTolerance(Number(event.target.value))} className="w-full accent-cyan-400" />
      <div className="mt-1 flex justify-between text-xs text-slate-400">
        <span>1 · {copy.accurate}</span><span>10 · {copy.smaller}</span>
      </div>
      <p id={`${id}-help`} className="mt-5 text-sm leading-relaxed text-slate-300">{copy.help}</p>
      <div className="mt-5 flex justify-end gap-2 border-t border-slate-700 pt-4">
        <button type="button" onClick={() => onClose(null)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:border-slate-400">{copy.cancel}</button>
        <button type="submit" className="rounded-lg border border-cyan-500/70 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/25">{copy.export}</button>
      </div>
    </form>
  </ModalFrame>;
}
