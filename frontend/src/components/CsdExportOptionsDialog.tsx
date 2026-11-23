import { useEffect, useId, useRef, useState } from "react";
import type { CsdExportControls, CsdExportOptions } from "../hooks/useCsdExportOptionsDialog";
import type { GuiLanguage } from "../types";
import { ModalFrame } from "./ModalFrame";

const COPY = {
  english: {
    title: "CSD export options",
    sampleLocation: "Export samples in the assets/ subfolder",
    sampleHelp: "Clear to place the files beside the CSD.",
    description: "Original controller curves are preserved whenever possible.",
    label: "Maximum deviation", accurate: "More accurate", smaller: "Smaller file",
    help: "This limit applies only to curves that need approximation. Original curves, including note-start parameters, keep their sampled values. Higher limits can reduce fallback curve data but change the sound more. Step patterns and resets remain exact.",
    cancel: "Cancel", export: "Export CSD"
  },
  german: {
    title: "CSD-Exportoptionen",
    sampleLocation: "Samples im Unterordner assets/ exportieren",
    sampleHelp: "Ohne Häkchen liegen die Dateien im selben Ordner wie die CSD-Datei.",
    description: "Originale Controller-Kurven bleiben nach Möglichkeit erhalten.",
    label: "Maximale Abweichung", accurate: "Genauer", smaller: "Kleinere Datei",
    help: "Diese Grenze gilt nur für Kurven, die angenähert werden müssen. Originalkurven behalten ihre abgetasteten Werte, auch für Parameter beim Notenstart. Höhere Grenzen können die Näherungsdaten verkleinern, aber den Klang stärker verändern. Step-Patterns und Rücksetzwerte bleiben exakt.",
    cancel: "Abbrechen", export: "CSD exportieren"
  },
  french: {
    title: "Options d’export CSD",
    sampleLocation: "Exporter les échantillons dans le sous-dossier assets/",
    sampleHelp: "Décochez cette case pour placer les fichiers dans le même dossier que le CSD.",
    description: "Les courbes de contrôleur originales sont conservées lorsque c’est possible.",
    label: "Écart maximal", accurate: "Plus précis", smaller: "Fichier plus petit",
    help: "Cette limite concerne uniquement les courbes nécessitant une approximation. Les courbes originales conservent leurs valeurs échantillonnées, y compris pour les paramètres au début des notes. Une limite plus élevée peut réduire les données approximatives, mais modifier davantage le son. Les motifs Step et les réinitialisations restent exacts.",
    cancel: "Annuler", export: "Exporter CSD"
  },
  spanish: {
    title: "Opciones de exportación CSD",
    sampleLocation: "Exportar las muestras en la subcarpeta assets/",
    sampleHelp: "Desmarca la casilla para guardar los archivos en la misma carpeta que el CSD.",
    description: "Las curvas de controlador originales se conservan siempre que sea posible.",
    label: "Desviación máxima", accurate: "Más preciso", smaller: "Archivo más pequeño",
    help: "Este límite solo afecta a las curvas que necesitan aproximación. Las curvas originales mantienen sus valores muestreados, incluidos los parámetros al inicio de las notas. Un límite mayor puede reducir los datos aproximados, pero cambiar más el sonido. Los patrones Step y los reinicios permanecen exactos.",
    cancel: "Cancelar", export: "Exportar CSD"
  }
} satisfies Record<GuiLanguage, Record<string, string>>;

export function CsdExportOptionsDialog({ guiLanguage, showCurveAccuracy, showSampleLocation, onClose }: CsdExportControls & {
  guiLanguage: GuiLanguage;
  onClose: (options: CsdExportOptions | null) => void;
}) {
  const copy = COPY[guiLanguage];
  const id = useId();
  const [tolerance, setTolerance] = useState(1);
  const form = useRef<HTMLFormElement>(null);
  const [samplesInSubfolder, setSamplesInSubfolder] = useState(true);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    form.current?.querySelector("input")?.focus();
    return () => previous?.focus();
  }, []);

  return <ModalFrame ariaLabel={copy.title} title={copy.title} subtitle={showCurveAccuracy ? copy.description : undefined}
    maxWidthClassName="max-w-lg" onClose={() => onClose(null)} closeOnEscape>
    <form ref={form} onSubmit={event => {
      event.preventDefault();
      onClose({
        ...(showCurveAccuracy && { controllerCurveTolerance: tolerance }),
        ...(showSampleLocation && { samplesInSubfolder })
      });
    }} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = form.current?.querySelectorAll<HTMLElement>("input, button");
      const first = controls?.[0], last = controls?.[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      {showCurveAccuracy && <>
        <div className="mb-4 flex items-center justify-between gap-3">
          <label htmlFor={id} className="text-sm font-semibold text-slate-100">{copy.label}</label>
          <output htmlFor={id} className="min-w-20 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-center font-mono text-lg text-cyan-200">{tolerance} CC</output>
        </div>
        <input id={id} type="range" min={1} max={10} step={1} value={tolerance}
          aria-describedby={`${id}-help`} aria-valuetext={`${tolerance} CC`}
          onChange={event => setTolerance(Number(event.target.value))} className="w-full accent-cyan-400" />
        <div className="mt-1 flex justify-between text-xs text-slate-400">
          <span>1 · {copy.accurate}</span><span>10 · {copy.smaller}</span>
        </div>
        <p id={`${id}-help`} className="mt-5 text-sm leading-relaxed text-slate-300">{copy.help}</p>
      </>}
      {showSampleLocation && <div className={showCurveAccuracy ? "mt-4 border-t border-slate-700 pt-4" : undefined}>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <input type="checkbox" checked={samplesInSubfolder} aria-describedby={`${id}-samples`}
            onChange={event => setSamplesInSubfolder(event.target.checked)} className="accent-cyan-400" />
          {copy.sampleLocation}
        </label>
        <p id={`${id}-samples`} className="mt-1 text-sm text-slate-300">{copy.sampleHelp}</p>
      </div>}
      <div className="mt-5 flex justify-end gap-2 border-t border-slate-700 pt-4">
        <button type="button" onClick={() => onClose(null)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:border-slate-400">{copy.cancel}</button>
        <button type="submit" className="rounded-lg border border-cyan-500/70 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/25">{copy.export}</button>
      </div>
    </form>
  </ModalFrame>;
}
