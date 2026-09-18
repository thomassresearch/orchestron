import type { GuiLanguage } from "../types";

const en = {
  holdPreview: "Hold 0.25 s to preview; release to resume previous playback.", setColor: "Set colour…", resetColor: "Reset colour", customColor: "Custom colour", newDefinition: "Create new definition", updateDefinition: "Update existing definition", apply: "Apply", cancelEdit: "Cancel", groupHint: "Select at least two adjacent elements. Groups accept pads/rests; supergroups also accept groups.", actions: "Lane actions", editPattern: "Edit pattern", dragHint: "Drag to the lane; edges insert, empty space places.",
  settings: "Playback settings", mute: "Mute", solo: "Solo", laneOnly: "Only this lane; existing notes finish their releases.", soloSuppressed: "Suppressed by another lane’s Solo", outputError: "Lane output update failed.",
  library: "Patterns and phrases", source: "Playback source", arrangement: "Arrangement", manual: "Manual pads",
  atEnd: "At end", once: "Stop track", repeat: "Repeat track sequence", open: "Open in arranger",
  newGroup: "New group", newSuper: "New supergroup", group: "Group", super: "Supergroup", rest: "Rest",
  edit: "Edit", editing: "Editing", playing: "Playing", queued: "Queued", audition: "Audition", auditioning: "Auditioning",
  stopAudition: "Stop audition", return: "Return to arrangement", cancel: "Cancel launch", launch: "Launch pad",
  shared: "Edits update all occurrences. Length changes shift following items.", used: "Used in", removeDefinition: "Delete definition",
  empty: "Add pads or rests to this phrase.", add: "Add", newPattern: "New pattern", noSlot: "All eight pads are in use.",
  remove: "Remove, leave gap", closeGap: "Remove and close gap", insert: "Insert and shift later items",
  duplicate: "Duplicate occurrence", variation: "Create variation", duration: "Duration (beats)", position: "Position (master beats)",
  blocked: "This edit is not allowed: check phrase references, timing, and the 256-token limit.",
  collision: "The item does not fit here. Choose an empty span or insert at an item boundary.",
  loop: "Loop selected range", emptyLane: "Add an item to enable arrangement playback.", beats: "beats", select: "Select lane",
  manualHint: "Arranger Play stops manual sequencers.", fill: "Choose a phrase to edit.", newEmpty: "Unused pad"
};
export type ArrangementCopy = typeof en;
const de: ArrangementCopy = {
  holdPreview: "Zum Vorhören 0,25 s gedrückt halten; Loslassen stellt die vorherige Wiedergabe wieder her.", setColor: "Farbe festlegen…", resetColor: "Farbe zurücksetzen", customColor: "Eigene Farbe", newDefinition: "Neue Definition erstellen", updateDefinition: "Bestehende Definition aktualisieren", apply: "Anwenden", cancelEdit: "Abbrechen", groupHint: "Mindestens zwei benachbarte Elemente wählen. Gruppen erlauben Pads/Pausen; Supergruppen zusätzlich Gruppen.", actions: "Spuraktionen", editPattern: "Pattern bearbeiten", dragHint: "In die Spur ziehen; Kanten fügen ein, freie Stellen platzieren.",
  settings: "Wiedergabeeinstellungen", mute: "Mute", solo: "Solo", laneOnly: "Nur diese Spur; klingende Noten klingen aus.", soloSuppressed: "Durch Solo einer anderen Spur stumm", outputError: "Spurausgabe konnte nicht aktualisiert werden.",
  library: "Patterns und Phrasen", source: "Wiedergabequelle", arrangement: "Arrangement", manual: "Manuelle Pads",
  atEnd: "Am Ende", once: "Spur stoppen", repeat: "Spursequenz wiederholen", open: "Im Arranger öffnen",
  newGroup: "Neue Gruppe", newSuper: "Neue Supergruppe", group: "Gruppe", super: "Supergruppe", rest: "Pause",
  edit: "Bearbeiten", editing: "Bearbeitung", playing: "Wiedergabe", queued: "Vorgemerkt", audition: "Vorhören", auditioning: "Vorhören aktiv",
  stopAudition: "Vorhören stoppen", return: "Zurück zum Arrangement", cancel: "Start abbrechen", launch: "Pad starten",
  shared: "Änderungen gelten für alle Vorkommen. Längenänderungen verschieben folgende Elemente.", used: "Verwendet in", removeDefinition: "Definition löschen",
  empty: "Pads oder Pausen zu dieser Phrase hinzufügen.", add: "Hinzufügen", newPattern: "Neues Pattern", noSlot: "Alle acht Pads sind belegt.",
  remove: "Entfernen, Pause lassen", closeGap: "Entfernen und Lücke schließen", insert: "Einfügen und Folgeelemente verschieben",
  duplicate: "Vorkommen duplizieren", variation: "Variation erstellen", duration: "Dauer (Beats)", position: "Position (Master-Beats)",
  blocked: "Diese Änderung ist nicht möglich: Phrasenreferenzen, Timing und das Limit von 256 Tokens prüfen.",
  collision: "Das Element passt hier nicht. Eine freie Stelle wählen oder an einer Elementgrenze einfügen.",
  loop: "Ausgewählten Bereich wiederholen", emptyLane: "Ein Element hinzufügen, um das Arrangement zu aktivieren.", beats: "Beats", select: "Spur wählen",
  manualHint: "Arranger-Start stoppt manuelle Sequencer.", fill: "Eine Phrase zum Bearbeiten wählen.", newEmpty: "Unbenutztes Pad"
};
const fr: ArrangementCopy = {
  holdPreview: "Maintenir 0,25 s pour écouter ; relâcher pour reprendre la lecture précédente.", setColor: "Définir la couleur…", resetColor: "Rétablir la couleur", customColor: "Couleur personnalisée", newDefinition: "Créer une définition", updateDefinition: "Modifier une définition existante", apply: "Appliquer", cancelEdit: "Annuler", groupHint: "Sélectionner au moins deux éléments adjacents. Groupes : pads/silences ; supergroupes : groupes également.", actions: "Actions de piste", editPattern: "Modifier le motif", dragHint: "Glisser dans la piste ; les bords insèrent, les espaces libres accueillent.",
  settings: "Réglages de lecture", mute: "Muet", solo: "Solo", laneOnly: "Cette piste uniquement ; les notes en cours se terminent.", soloSuppressed: "Désactivée par le Solo d’une autre piste", outputError: "Échec de la mise à jour de la sortie de piste.",
  library: "Motifs et phrases", source: "Source de lecture", arrangement: "Arrangement", manual: "Pads manuels",
  atEnd: "À la fin", once: "Arrêter la piste", repeat: "Répéter la séquence", open: "Ouvrir dans l’arrangeur",
  newGroup: "Nouveau groupe", newSuper: "Nouveau supergroupe", group: "Groupe", super: "Supergroupe", rest: "Silence",
  edit: "Modifier", editing: "Édition", playing: "Lecture", queued: "En attente", audition: "Écouter", auditioning: "Écoute temporaire",
  stopAudition: "Arrêter l’écoute", return: "Retour à l’arrangement", cancel: "Annuler le lancement", launch: "Lancer le pad",
  shared: "Les modifications affectent toutes les occurrences. La durée décale les éléments suivants.", used: "Utilisé dans", removeDefinition: "Supprimer la définition",
  empty: "Ajouter des pads ou des silences à cette phrase.", add: "Ajouter", newPattern: "Nouveau motif", noSlot: "Les huit pads sont utilisés.",
  remove: "Supprimer en laissant un silence", closeGap: "Supprimer et fermer l’espace", insert: "Insérer et décaler la suite",
  duplicate: "Dupliquer l’occurrence", variation: "Créer une variation", duration: "Durée (temps)", position: "Position (temps maîtres)",
  blocked: "Modification impossible : vérifier les références, le timing et la limite de 256 éléments.",
  collision: "L’élément ne tient pas ici. Choisir un espace libre ou insérer à une limite d’élément.",
  loop: "Boucler la plage sélectionnée", emptyLane: "Ajouter un élément pour activer l’arrangement.", beats: "temps", select: "Choisir la piste",
  manualHint: "La lecture de l’arrangeur arrête les séquenceurs manuels.", fill: "Choisir une phrase à modifier.", newEmpty: "Pad inutilisé"
};
const es: ArrangementCopy = {
  holdPreview: "Mantén 0,25 s para escuchar; suelta para recuperar la reproducción anterior.", setColor: "Elegir color…", resetColor: "Restablecer color", customColor: "Color personalizado", newDefinition: "Crear definición", updateDefinition: "Actualizar definición existente", apply: "Aplicar", cancelEdit: "Cancelar", groupHint: "Selecciona al menos dos elementos adyacentes. Grupos: pads/silencios; supergrupos: también grupos.", actions: "Acciones de pista", editPattern: "Editar patrón", dragHint: "Arrastra a la pista; los bordes insertan y los huecos permiten colocar.",
  settings: "Ajustes de reproducción", mute: "Mute", solo: "Solo", laneOnly: "Solo esta pista; las notas activas terminan normalmente.", soloSuppressed: "Silenciada por el Solo de otra pista", outputError: "No se pudo actualizar la salida de la pista.",
  library: "Patrones y frases", source: "Fuente de reproducción", arrangement: "Arreglo", manual: "Pads manuales",
  atEnd: "Al finalizar", once: "Detener pista", repeat: "Repetir secuencia", open: "Abrir en el arreglador",
  newGroup: "Nuevo grupo", newSuper: "Nuevo supergrupo", group: "Grupo", super: "Supergrupo", rest: "Silencio",
  edit: "Editar", editing: "Edición", playing: "Reproducción", queued: "En espera", audition: "Escuchar", auditioning: "Escucha temporal",
  stopAudition: "Detener escucha", return: "Volver al arreglo", cancel: "Cancelar lanzamiento", launch: "Lanzar pad",
  shared: "Los cambios afectan a todas las apariciones. La duración desplaza los elementos siguientes.", used: "Usado en", removeDefinition: "Eliminar definición",
  empty: "Añadir pads o silencios a esta frase.", add: "Añadir", newPattern: "Nuevo patrón", noSlot: "Los ocho pads están ocupados.",
  remove: "Eliminar dejando silencio", closeGap: "Eliminar y cerrar hueco", insert: "Insertar y desplazar los siguientes",
  duplicate: "Duplicar aparición", variation: "Crear variación", duration: "Duración (pulsos)", position: "Posición (pulsos maestros)",
  blocked: "Cambio no permitido: revisar referencias, sincronización y el límite de 256 elementos.",
  collision: "El elemento no cabe aquí. Elegir un hueco o insertar en el límite de un elemento.",
  loop: "Repetir intervalo seleccionado", emptyLane: "Añadir un elemento para activar el arreglo.", beats: "pulsos", select: "Elegir pista",
  manualHint: "Iniciar el arreglador detiene los secuenciadores manuales.", fill: "Elegir una frase para editar.", newEmpty: "Pad sin usar"
};
export function arrangementCopy(language: GuiLanguage): ArrangementCopy {
  return language === "german" ? de : language === "french" ? fr : language === "spanish" ? es : en;
}
