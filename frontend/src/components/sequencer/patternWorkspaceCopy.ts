import type { GuiLanguage } from "../../types";

const en = {
  workspace: "Pattern workspace", free: "Free workspace", play: "Play workspace", stop: "Stop workspace",
  saved: "Saved phrases", hint: "Drag pads or phrases here. Cmd/Ctrl-click to select; right-click to group or split.",
  group: "Group", super: "Supergroup", split: "Ungroup", remove: "Remove", clear: "Clear workspace",
  edit: "Edit", apply: "Apply", saveNew: "Save as new", discard: "Discard changes", rest: "Add rest…",
  delete: "Delete definition", draftUse: "workspace draft", changes: "Unapplied changes",
  empty: "Drop pads here", invalid: "Cannot apply this edit. Check the phrase hierarchy, references and 256-token limit.",
  temporary: "Loose items are temporary. Group a selection to save a phrase.",
  update: "Apply updates every occurrence. Changing duration shifts following arrangement material.",
  queued: "Queued", auditioning: "Playing workspace", actions: "Workspace actions"
};
type Copy = typeof en;
const de: Copy = {
  workspace: "Pattern-Arbeitsfläche", free: "Freie Arbeitsfläche", play: "Arbeitsfläche abspielen", stop: "Arbeitsfläche stoppen",
  saved: "Gespeicherte Phrasen", hint: "Pads oder Phrasen hierher ziehen. Cmd/Strg-Klick wählt aus; Rechtsklick gruppiert oder löst Gruppen auf.",
  group: "Gruppieren", super: "Supergruppe", split: "Gruppe auflösen", remove: "Entfernen", clear: "Arbeitsfläche leeren",
  edit: "Bearbeiten", apply: "Übernehmen", saveNew: "Als neu speichern", discard: "Änderungen verwerfen", rest: "Pause hinzufügen…",
  delete: "Definition löschen", draftUse: "Arbeitsflächenentwurf", changes: "Nicht übernommene Änderungen",
  empty: "Pads hier ablegen", invalid: "Änderung nicht möglich. Phrasenhierarchie, Referenzen und das Limit von 256 Tokens prüfen.",
  temporary: "Einzelne Elemente sind temporär. Auswahl gruppieren, um eine Phrase zu speichern.",
  update: "Übernehmen ändert alle Vorkommen. Längenänderungen verschieben folgende Arrangement-Elemente.",
  queued: "Vorgemerkt", auditioning: "Arbeitsfläche spielt", actions: "Arbeitsflächenaktionen"
};
const fr: Copy = {
  workspace: "Atelier de motifs", free: "Assemblage libre", play: "Lire l’assemblage", stop: "Arrêter l’assemblage",
  saved: "Phrases enregistrées", hint: "Glisser des motifs ou phrases ici. Cmd/Ctrl-clic sélectionne ; clic droit pour grouper ou dissocier.",
  group: "Grouper", super: "Supergroupe", split: "Dissocier", remove: "Retirer", clear: "Vider l’assemblage",
  edit: "Modifier", apply: "Appliquer", saveNew: "Enregistrer une copie", discard: "Annuler les modifications", rest: "Ajouter un silence…",
  delete: "Supprimer la définition", draftUse: "brouillon d’assemblage", changes: "Modifications non appliquées",
  empty: "Déposer des motifs ici", invalid: "Modification impossible. Vérifier la hiérarchie, les références et la limite de 256 éléments.",
  temporary: "Les éléments libres sont temporaires. Grouper une sélection pour enregistrer une phrase.",
  update: "Appliquer modifie toutes les utilisations. La durée décale les éléments suivants de l’arrangement.",
  queued: "En attente", auditioning: "Lecture de l’assemblage", actions: "Actions de l’assemblage"
};
const es: Copy = {
  workspace: "Taller de patrones", free: "Montaje libre", play: "Reproducir montaje", stop: "Detener montaje",
  saved: "Frases guardadas", hint: "Arrastra patrones o frases aquí. Cmd/Ctrl-clic selecciona; clic derecho para agrupar o separar.",
  group: "Agrupar", super: "Supergrupo", split: "Desagrupar", remove: "Quitar", clear: "Vaciar montaje",
  edit: "Editar", apply: "Aplicar", saveNew: "Guardar como nuevo", discard: "Descartar cambios", rest: "Añadir silencio…",
  delete: "Eliminar definición", draftUse: "borrador del montaje", changes: "Cambios sin aplicar",
  empty: "Suelta patrones aquí", invalid: "No se puede aplicar. Comprueba la jerarquía, las referencias y el límite de 256 elementos.",
  temporary: "Los elementos sueltos son temporales. Agrupa una selección para guardar una frase.",
  update: "Aplicar modifica todos los usos. La duración desplaza el material posterior del arreglo.",
  queued: "En espera", auditioning: "Reproduciendo montaje", actions: "Acciones del montaje"
};
export const patternWorkspaceCopy = (language: GuiLanguage): Copy => ({ english: en, german: de, french: fr, spanish: es })[language];
