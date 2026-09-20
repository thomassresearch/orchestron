import type { GuiLanguage } from "../types";
import { arrangerActionCodes, type ArrangerHistoryEntry } from "../store/arrangerHistory";

const copy = {
  english: { undo: "Undo", redo: "Redo", past: "Undo history", future: "Redo history", hold: "Hold to show history", cleared: "Arranger history was cleared because related content changed or saved history was invalid.",
    actions: ["Place", "Move", "Remove, leave gap", "Remove and close gap", "Resize rest", "Group", "Supergroup", "Ungroup", "Create variation", "Delete definition", "Change colour", "Change playback source", "Change repeat", "Paste — overwrite", "Insert — all lanes", "Insert — copied lanes", "Duplicate — all lanes", "Duplicate — selected lanes"] },
  german: { undo: "Rückgängig", redo: "Wiederholen", past: "Rückgängig-Verlauf", future: "Wiederherstellungsverlauf", hold: "Gedrückt halten, um den Verlauf zu öffnen", cleared: "Der Arranger-Verlauf wurde gelöscht, weil sich zugehörige Inhalte geändert haben oder der gespeicherte Verlauf ungültig war.",
    actions: ["Platzieren", "Verschieben", "Entfernen, Lücke lassen", "Entfernen und Lücke schließen", "Pause ändern", "Gruppieren", "Supergruppe bilden", "Gruppierung aufheben", "Variation erstellen", "Definition löschen", "Farbe ändern", "Wiedergabequelle ändern", "Wiederholung ändern", "Einfügen — überschreiben", "Einfügen — alle Spuren", "Einfügen — kopierte Spuren", "Duplizieren — alle Spuren", "Duplizieren — ausgewählte Spuren"] },
  french: { undo: "Annuler", redo: "Rétablir", past: "Historique d’annulation", future: "Historique de rétablissement", hold: "Maintenir pour afficher l’historique", cleared: "L’historique de l’arrangeur a été effacé car du contenu lié a changé ou l’historique enregistré était invalide.",
    actions: ["Placer", "Déplacer", "Supprimer en laissant un silence", "Supprimer et fermer l’espace", "Modifier le silence", "Grouper", "Créer un supergroupe", "Dégrouper", "Créer une variation", "Supprimer la définition", "Changer la couleur", "Changer la source de lecture", "Changer la répétition", "Coller — écraser", "Insérer — toutes les pistes", "Insérer — pistes copiées", "Dupliquer — toutes les pistes", "Dupliquer — pistes sélectionnées"] },
  spanish: { undo: "Deshacer", redo: "Rehacer", past: "Historial para deshacer", future: "Historial para rehacer", hold: "Mantener pulsado para ver el historial", cleared: "Se ha borrado el historial del arreglador porque cambió contenido relacionado o el historial guardado no era válido.",
    actions: ["Colocar", "Mover", "Eliminar dejando silencio", "Eliminar y cerrar hueco", "Cambiar silencio", "Agrupar", "Crear supergrupo", "Desagrupar", "Crear variación", "Eliminar definición", "Cambiar color", "Cambiar fuente de reproducción", "Cambiar repetición", "Pegar — sobrescribir", "Insertar — todas las pistas", "Insertar — pistas copiadas", "Duplicar — todas las pistas", "Duplicar — pistas seleccionadas"] }
};
export function arrangerHistoryCopy(language: GuiLanguage) {
  const c = copy[language];
  return { ...c, label: (entry: ArrangerHistoryEntry) => `${c.actions[arrangerActionCodes.indexOf(entry.action)]} · ${entry.labels.join(", ")}` };
}
