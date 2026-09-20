import type { GuiLanguage } from "../types";

const en = {
  ruler: "Arrangement edit ruler", actions: "Range actions", copy: "Copy range", paste: "Paste — overwrite",
  insertAll: "Paste — insert time, all lanes", insertSelected: "Paste — insert, copied lanes only",
  duplicateAll: "Duplicate — insert time, all lanes", duplicateSelected: "Duplicate — insert, selected lanes only",
  undo: "Undo range edit", redo: "Redo range edit", overwrite: "Overwrite", insert: "Insert", all: "all lanes",
  lane: "lane", lanes: "lanes", beat: "beat", beats: "beats", cursor: "Edit position", copied: "Range copied", empty: "Select a range first.",
  hint: "Drag the ruler for all lanes; drag empty timeline space or Shift-drag for selected lanes. Right-click for copy, paste and duplicate.",
  dragHint: "Alt/Option-drag copies; add Shift to insert time across all lanes.",
  boundary: "Choose an element boundary; musical elements cannot be split.",
  timing: "This position or duration is not a whole local beat on every affected lane.",
  missing: "A copied lane is no longer available. Copy the range again.",
  changed: "Pattern lengths or definitions changed. Copy the range again.",
  limit: "This edit exceeds an arrangement limit or contains an invalid reference.",
  noClipboard: "Copy a range first."
};
type Copy = typeof en;
const de: Copy = {
  ruler: "Arrangement-Bearbeitungslineal", actions: "Bereichsaktionen", copy: "Bereich kopieren", paste: "Einfügen — überschreiben",
  insertAll: "Einfügen — Zeit auf allen Spuren", insertSelected: "Einfügen — nur kopierte Spuren verschieben",
  duplicateAll: "Duplizieren — Zeit auf allen Spuren", duplicateSelected: "Duplizieren — nur gewählte Spuren verschieben",
  undo: "Bereichsänderung rückgängig", redo: "Bereichsänderung wiederholen", overwrite: "Überschreiben", insert: "Einfügen", all: "alle Spuren",
  lane: "Spur", lanes: "Spuren", beat: "Beat", beats: "Beats", cursor: "Bearbeitungsposition", copied: "Bereich kopiert", empty: "Zuerst einen Bereich wählen.",
  hint: "Im Lineal für alle Spuren ziehen; im freien Zeitbereich oder mit Umschalt für gewählte Spuren ziehen. Rechtsklick zum Kopieren, Einfügen und Duplizieren.",
  dragHint: "Alt/Option-Ziehen kopiert; zusätzlich Umschalt fügt Zeit auf allen Spuren ein.",
  boundary: "Eine Elementgrenze wählen; musikalische Elemente können nicht geteilt werden.",
  timing: "Position oder Dauer entspricht nicht auf jeder betroffenen Spur ganzen lokalen Beats.",
  missing: "Eine kopierte Spur ist nicht mehr verfügbar. Den Bereich erneut kopieren.",
  changed: "Patternlängen oder Definitionen wurden geändert. Den Bereich erneut kopieren.",
  limit: "Die Änderung überschreitet ein Arrangement-Limit oder enthält eine ungültige Referenz.",
  noClipboard: "Zuerst einen Bereich kopieren."
};
const fr: Copy = {
  ruler: "Règle d’édition de l’arrangement", actions: "Actions de plage", copy: "Copier la plage", paste: "Coller — écraser",
  insertAll: "Coller — insérer du temps, toutes les pistes", insertSelected: "Coller — décaler les pistes copiées seulement",
  duplicateAll: "Dupliquer — insérer du temps, toutes les pistes", duplicateSelected: "Dupliquer — décaler les pistes sélectionnées seulement",
  undo: "Annuler la modification de plage", redo: "Rétablir la modification de plage", overwrite: "Écraser", insert: "Insérer", all: "toutes les pistes",
  lane: "piste", lanes: "pistes", beat: "temps", beats: "temps", cursor: "Position d’édition", copied: "Plage copiée", empty: "Sélectionner d’abord une plage.",
  hint: "Glisser sur la règle pour toutes les pistes ; glisser dans le fond vide ou avec Maj pour certaines pistes. Clic droit pour copier, coller et dupliquer.",
  dragHint: "Alt/Option-glisser copie ; ajouter Maj insère du temps sur toutes les pistes.",
  boundary: "Choisir une limite d’élément ; les éléments musicaux ne peuvent pas être divisés.",
  timing: "La position ou la durée ne correspond pas à des temps locaux entiers sur chaque piste concernée.",
  missing: "Une piste copiée n’est plus disponible. Copier à nouveau la plage.",
  changed: "Les durées ou définitions ont changé. Copier à nouveau la plage.",
  limit: "Cette modification dépasse une limite de l’arrangement ou contient une référence invalide.",
  noClipboard: "Copier d’abord une plage."
};
const es: Copy = {
  ruler: "Regla de edición del arreglo", actions: "Acciones de intervalo", copy: "Copiar intervalo", paste: "Pegar — sobrescribir",
  insertAll: "Pegar — insertar tiempo, todas las pistas", insertSelected: "Pegar — desplazar solo las pistas copiadas",
  duplicateAll: "Duplicar — insertar tiempo, todas las pistas", duplicateSelected: "Duplicar — desplazar solo las pistas seleccionadas",
  undo: "Deshacer edición del intervalo", redo: "Rehacer edición del intervalo", overwrite: "Sobrescribir", insert: "Insertar", all: "todas las pistas",
  lane: "pista", lanes: "pistas", beat: "pulso", beats: "pulsos", cursor: "Posición de edición", copied: "Intervalo copiado", empty: "Selecciona primero un intervalo.",
  hint: "Arrastra en la regla para todas las pistas; arrastra en el fondo vacío o con Mayús para algunas pistas. Clic derecho para copiar, pegar y duplicar.",
  dragHint: "Alt/Option-arrastrar copia; añade Mayús para insertar tiempo en todas las pistas.",
  boundary: "Elige un límite de elemento; los elementos musicales no se pueden dividir.",
  timing: "La posición o duración no corresponde a pulsos locales enteros en todas las pistas afectadas.",
  missing: "Una pista copiada ya no está disponible. Copia el intervalo de nuevo.",
  changed: "Han cambiado las duraciones o definiciones. Copia el intervalo de nuevo.",
  limit: "Esta edición supera un límite del arreglo o contiene una referencia no válida.",
  noClipboard: "Copia primero un intervalo."
};
export function arrangementRangeCopy(language: GuiLanguage): Copy {
  return language === "german" ? de : language === "french" ? fr : language === "spanish" ? es : en;
}
