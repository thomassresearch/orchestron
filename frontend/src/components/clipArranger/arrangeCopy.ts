import type { GuiLanguage } from "../../types";
import type { DefinitionRelationship, EditScope } from "../../lib/clipArranger/relationships";
import { scopeCopy } from "../../lib/clipArranger/scopeCopy";

const labels = {
  english: { settings: "Channel, scale and timing", barBeat: "Bar and beat", pattern: "Save pattern here", structure: "Save structure here", linkedPattern: "Save linked pattern", linkedStructure: "Save linked structure", use: "use", uses: "uses", pass: "Pass", editPad: "Edit pad in Live", starter: "Create playable instrument" },
  german: { settings: "Kanal, Tonleiter und Timing", barBeat: "Takt und Schlag", pattern: "Pattern hier speichern", structure: "Struktur hier speichern", linkedPattern: "Verknüpftes Pattern speichern", linkedStructure: "Verknüpfte Struktur speichern", use: "Verwendung", uses: "Verwendungen", pass: "Durchlauf", editPad: "Pad in Live bearbeiten", starter: "Spielbares Instrument erstellen" },
  french: { settings: "Canal, gamme et rythme", barBeat: "Mesure et temps", pattern: "Enregistrer le motif ici", structure: "Enregistrer la structure ici", linkedPattern: "Enregistrer le motif lié", linkedStructure: "Enregistrer la structure liée", use: "utilisation", uses: "utilisations", pass: "Passage", editPad: "Modifier le pad dans Live", starter: "Créer un instrument jouable" },
  spanish: { settings: "Canal, escala y ritmo", barBeat: "Compás y pulso", pattern: "Guardar el patrón aquí", structure: "Guardar la estructura aquí", linkedPattern: "Guardar el patrón vinculado", linkedStructure: "Guardar la estructura vinculada", use: "uso", uses: "usos", pass: "Pasada", editPad: "Editar pad en En vivo", starter: "Crear instrumento tocable" }
};
export const arrangeCopy = (language: GuiLanguage) => labels[language];

export function arrangeSaveLabel(language: GuiLanguage, kind: "pattern" | "structure", scope: EditScope | null, relationship?: DefinitionRelationship) {
  const c = labels[language];
  if (scope === "local") return kind === "pattern" ? scopeCopy(language).saveLocal : c.structure;
  if (!scope || !relationship?.shared) return c[kind];
  const count = relationship.occurrences;
  return `${kind === "pattern" ? c.linkedPattern : c.linkedStructure} (${count} ${count === 1 ? c.use : c.uses})`;
}
