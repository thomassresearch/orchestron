import type { GuiLanguage } from "../../types";

const labels = {
  launch: ["Launch pads", "Pads starten", "Lancer les pads", "Lanzar pads"],
  preview: ["Preview pads", "Pads vorhören", "Écouter les pads", "Escuchar pads"],
  actions: ["Pad actions", "Pad-Aktionen", "Actions des pads", "Acciones de pad"],
  mode: ["Pad mode", "Pad-Modus", "Mode des pads", "Modo de pads"],
  populated: ["Populated", "Belegt", "Avec contenu", "Con contenido"],
  empty: ["Empty", "Leer", "Vide", "Vacío"],
  copyTo: ["Copy pad to…", "Pad kopieren nach…", "Copier le pad vers…", "Copiar pad a…"],
  copy: ["Copy", "Kopieren", "Copier", "Copiar"],
  replace: ["Replace", "Ersetzen", "Remplacer", "Reemplazar"],
  copied: ["Copied", "Kopiert", "Copié", "Copiado"],
  transpose: ["Transpose", "Transponieren", "Transposer", "Transponer"],
  inScale: ["Notes in scale", "Noten in der Skala", "Notes dans la gamme", "Notas en la escala"],
  keyStep: ["Move key by degree", "Tonart um eine Stufe versetzen", "Décaler la tonalité d’un degré", "Mover la tonalidad un grado"],
  up: ["Up", "Aufwärts", "Monter", "Subir"],
  down: ["Down", "Abwärts", "Descendre", "Bajar"],
  holdKey: ["Hold to move the key", "Halten, um die Tonart zu versetzen", "Maintenir pour décaler la tonalité", "Mantén para mover la tonalidad"],
  launcher: ["Pad launcher", "Pad-Launcher", "Lanceur de pads", "Lanzador de pads"],
  device: ["Device", "Gerät", "Appareil", "Dispositivo"],
  add: ["Add live device", "Live-Gerät hinzufügen", "Ajouter un appareil live", "Añadir dispositivo en vivo"],
  remove: ["Remove device", "Gerät entfernen", "Retirer l’appareil", "Quitar dispositivo"],
  edit: ["Edit", "Bearbeiten", "Modifier", "Editar"],
  boundary: ["End of pattern", "Patternende", "Fin du motif", "Fin del patrón"],
  saved: ["Pad saved in performance", "Pad in Performance gespeichert", "Pad enregistré dans la performance", "Pad guardado en la interpretación"],
  unsaved: ["Unsaved pad changes", "Ungespeicherte Pad-Änderungen", "Modifications du pad non enregistrées", "Cambios del pad sin guardar"],
  saveHint: ["Save Performance keeps these edits", "Performance speichern sichert diese Änderungen", "Enregistrer la performance conserve ces modifications", "Guardar interpretación conserva estos cambios"],
  settings: ["Keyboard settings", "Klaviatureinstellungen", "Réglages du clavier", "Ajustes del teclado"]
};

export function liveCopy(language: GuiLanguage) {
  const i = { english: 0, german: 1, french: 2, spanish: 3 }[language];
  return (key: keyof typeof labels) => labels[key][i];
}
