import type { GuiLanguage } from "../../types";
import type { DefinitionRelationship, EditScope } from "../../lib/clipArranger/relationships";
import { scopeCopy } from "../../lib/clipArranger/scopeCopy";

const labels = {
  english: {
    clipName: "Clip name", renameClip: "Rename clip",
    renamePattern: "Rename pattern", patternName: "Pattern name", groupName: "Group name", cancelEdits: "Cancel edits", discardEdits: "Discard edits", keepEditing: "Keep editing", closeQuestion: "Save changes to this pattern?", loopDetails: "Loop details", removeInstrument: "Remove instrument", usedBy: "Used by these tracks",
    settings: "Settings", barBeat: "Bar and beat", pattern: "Save pattern here", structure: "Save structure here", linkedPattern: "Save linked pattern", linkedStructure: "Save linked structure", use: "use", uses: "uses", pass: "Pass", editPad: "Edit pad in Live", starter: "Create playable instrument" },
  german: {
    clipName: "Clipname", renameClip: "Clip umbenennen",
    renamePattern: "Pattern umbenennen", patternName: "Patternname", groupName: "Gruppenname", cancelEdits: "Bearbeitung abbrechen", discardEdits: "Änderungen verwerfen", keepEditing: "Weiter bearbeiten", closeQuestion: "Änderungen an diesem Pattern speichern?", loopDetails: "Schleifendetails", removeInstrument: "Instrument entfernen", usedBy: "Von diesen Spuren verwendet",
    settings: "Einstellungen", barBeat: "Takt und Schlag", pattern: "Pattern hier speichern", structure: "Struktur hier speichern", linkedPattern: "Verknüpftes Pattern speichern", linkedStructure: "Verknüpfte Struktur speichern", use: "Verwendung", uses: "Verwendungen", pass: "Durchlauf", editPad: "Pad in Live bearbeiten", starter: "Spielbares Instrument erstellen" },
  french: {
    clipName: "Nom du clip", renameClip: "Renommer le clip",
    renamePattern: "Renommer le motif", patternName: "Nom du motif", groupName: "Nom du groupe", cancelEdits: "Annuler les modifications", discardEdits: "Abandonner les modifications", keepEditing: "Continuer à modifier", closeQuestion: "Enregistrer les modifications de ce motif ?", loopDetails: "Détails de la boucle", removeInstrument: "Retirer l’instrument", usedBy: "Utilisé par ces pistes",
    settings: "Réglages", barBeat: "Mesure et temps", pattern: "Enregistrer le motif ici", structure: "Enregistrer la structure ici", linkedPattern: "Enregistrer le motif lié", linkedStructure: "Enregistrer la structure liée", use: "utilisation", uses: "utilisations", pass: "Passage", editPad: "Modifier le pad dans Live", starter: "Créer un instrument jouable" },
  spanish: {
    clipName: "Nombre del clip", renameClip: "Renombrar clip",
    renamePattern: "Renombrar patrón", patternName: "Nombre del patrón", groupName: "Nombre del grupo", cancelEdits: "Cancelar cambios", discardEdits: "Descartar cambios", keepEditing: "Seguir editando", closeQuestion: "¿Guardar los cambios en este patrón?", loopDetails: "Detalles del bucle", removeInstrument: "Quitar instrumento", usedBy: "Utilizado por estas pistas",
    settings: "Ajustes", barBeat: "Compás y pulso", pattern: "Guardar el patrón aquí", structure: "Guardar la estructura aquí", linkedPattern: "Guardar el patrón vinculado", linkedStructure: "Guardar la estructura vinculada", use: "uso", uses: "usos", pass: "Pasada", editPad: "Editar pad en En vivo", starter: "Crear instrumento tocable" }
};
export const arrangeCopy = (language: GuiLanguage) => labels[language];

export function arrangeSaveLabel(language: GuiLanguage, kind: "pattern" | "structure", scope: EditScope | null, relationship?: DefinitionRelationship) {
  const c = labels[language];
  if (scope === "local") return kind === "pattern" ? scopeCopy(language).saveLocal : c.structure;
  if (!scope || !relationship?.shared) return c[kind];
  const count = relationship.occurrences;
  return `${kind === "pattern" ? c.linkedPattern : c.linkedStructure} (${count} ${count === 1 ? c.use : c.uses})`;
}
