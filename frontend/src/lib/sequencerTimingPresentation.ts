import { sequencerTransportSubunitCount, sequencerTransportSubunitsPerBeat } from "./sequencer";
import type { GuiLanguage, SequencerTimingConfig, ControllerSequencerPadLengthBeats } from "../types";

const translations = {
  english: { meter: "Meter", length: "Pattern length", subdivision: "Subdivision", advanced: "Advanced timing", speed: "Playback speed", bar: "Bar", bars: "bars", beat: "Beat", beats: "beats", steps: "steps", perBeat: "per beat", scope: "Length: this pad. Meter, subdivision and speed: all pads.", songBeats: "quarter-note song beats", duration: "Plays over", limit: "Unavailable: a pad would exceed 128 steps.", notes: ["Quarter notes", "Eighth notes", "Sixteenth notes", "Thirty-second notes", "Sixty-fourth notes"], triplets: "triplets" },
  german: { meter: "Taktart", length: "Pattern-Länge", subdivision: "Unterteilung", advanced: "Erweitertes Timing", speed: "Wiedergabegeschwindigkeit", bar: "Takt", bars: "Takte", beat: "Zählzeit", beats: "Zählzeiten", steps: "Schritte", perBeat: "pro Zählzeit", scope: "Länge: dieses Pad. Taktart, Unterteilung und Tempoverhältnis: alle Pads.", songBeats: "Viertelschläge im Song", duration: "Spielt über", limit: "Nicht verfügbar: Ein Pad würde 128 Schritte überschreiten.", notes: ["Viertelnoten", "Achtelnoten", "Sechzehntelnoten", "Zweiunddreißigstelnoten", "Vierundsechzigstelnoten"], triplets: "Triolen" },
  french: { meter: "Mesure", length: "Longueur du motif", subdivision: "Subdivision", advanced: "Réglages temporels avancés", speed: "Vitesse de lecture", bar: "Mesure", bars: "mesures", beat: "Temps", beats: "temps", steps: "pas", perBeat: "par temps", scope: "Longueur : ce pad. Mesure, subdivision et vitesse : tous les pads.", songBeats: "temps en noires du morceau", duration: "Joué sur", limit: "Indisponible : un pad dépasserait 128 pas.", notes: ["Noires", "Croches", "Doubles croches", "Triples croches", "Quadruples croches"], triplets: "triolets" },
  spanish: { meter: "Compás", length: "Duración del patrón", subdivision: "Subdivisión", advanced: "Ajustes de tiempo avanzados", speed: "Velocidad de reproducción", bar: "Compás", bars: "compases", beat: "Pulso", beats: "pulsos", steps: "pasos", perBeat: "por pulso", scope: "Duración: este pad. Compás, subdivisión y velocidad: todos los pads.", songBeats: "pulsos de negra de la canción", duration: "Se reproduce en", limit: "No disponible: un pad superaría 128 pasos.", notes: ["Negras", "Corcheas", "Semicorcheas", "Fusas", "Semifusas"], triplets: "tresillos" }
} as const;
export const timingCopy = (language: GuiLanguage) => translations[language];

export function subdivisionLabel(grid: number, denominator: number, language: GuiLanguage): string {
  const c = timingCopy(language);
  const triplet = grid === 3 || grid === 6;
  const straight = triplet ? grid * 2 / 3 : grid;
  const name = c.notes[Math.log2(straight) + (denominator === 8 ? 1 : 0)];
  const musicalName = triplet && language === "english" ? `${name.replace(" notes", "-note")} triplets` : `${name}${triplet ? ` (${c.triplets})` : ""}`;
  return `${musicalName} · ${grid} ${c.perBeat}`;
}

export function patternLengthLabel(beats: number, numerator: number, language: GuiLanguage): string {
  const c = timingCopy(language);
  const singularBar = language === "german" ? c.bar : c.bar.toLowerCase();
  const singularBeat = language === "german" ? c.beat : c.beat.toLowerCase();
  const length = `${beats} ${beats === 1 ? singularBeat : c.beats}`;
  return beats % numerator === 0
    ? `${beats / numerator} ${beats === numerator ? singularBar : c.bars} · ${length}`
    : length;
}

export function timingSummary(timing: SequencerTimingConfig, length: ControllerSequencerPadLengthBeats, language: GuiLanguage): string {
  const c = timingCopy(language);
  const duration = sequencerTransportSubunitCount(timing, length) / sequencerTransportSubunitsPerBeat();
  const formatted = new Intl.NumberFormat({english:"en", german:"de", french:"fr", spanish:"es"}[language], { maximumFractionDigits: 3 }).format(duration);
  return `${length * timing.stepsPerBeat} ${c.steps} · ${timing.stepsPerBeat} ${c.perBeat} · ${c.duration} ${formatted} ${c.songBeats}`;
}

export function sequencerStepBoundary(timing: SequencerTimingConfig, step: number) {
  return { beatStart: step % timing.stepsPerBeat === 0, barStart: step % (timing.stepsPerBeat * timing.meterNumerator) === 0 };
}

export function sequencerBeatGroups(timing: SequencerTimingConfig, stepCount: number) {
  return Array.from({ length: Math.ceil(stepCount / timing.stepsPerBeat) }, (_, index) => ({
    start: index * timing.stepsPerBeat, count: Math.min(timing.stepsPerBeat, stepCount - index * timing.stepsPerBeat),
    beat: index % timing.meterNumerator + 1, bar: Math.floor(index / timing.meterNumerator) + 1,
    ...sequencerStepBoundary(timing, index * timing.stepsPerBeat)
  }));
}
