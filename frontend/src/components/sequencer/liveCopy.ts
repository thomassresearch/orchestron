import type { GuiLanguage } from "../../types";

const labels = {
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
