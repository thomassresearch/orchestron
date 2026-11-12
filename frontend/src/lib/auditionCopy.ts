import type { GuiLanguage } from "../types";
const english = {
  start: "Audition", stop: "Stop audition", preparing: "Preparing… · Cancel", stopping: "Stopping…",
  controls: "Audition controls", keyboard: "Audition keyboard", lower: "Octave down", higher: "Octave up",
  mapping: "Audition needs a stereo main output. Effects need a stereo main input for the built-in test instrument.",
  stale: "Draft changed. Stop and restart audition to hear the changes.", stopFailed: "Could not stop the current performance.",
  noNotes: "This continuous instrument plays without MIDI notes.",
  knob: "Drag vertically or use arrow keys; Shift adjusts finely. Double-click to reset. The value is temporary.",
  integer: "Enter a whole number or use the arrow keys. Enter or blur applies it; Escape cancels. The value is temporary.",
  bool: "Toggle this temporary setting on or off.",
  nextNote: "Changes apply to the next note or phrase.",
  live: "Changes apply live.", restart: "Stop and restart audition to apply this value. Temporary values are retained.",
  unused: "This control is not connected.",
};
type Copy = typeof english;
const copies: Record<GuiLanguage, Copy> = {
  english,
  german: {
    start: "Vorhören", stop: "Vorhören stoppen", preparing: "Vorbereiten… · Abbrechen", stopping: "Stoppen…",
    controls: "Vorhörregler", keyboard: "Vorhörtastatur", lower: "Oktave abwärts", higher: "Oktave aufwärts",
    mapping: "Vorhören benötigt einen Stereo-Hauptausgang. Effekte benötigen einen Stereo-Haupteingang für das integrierte Testinstrument.",
    stale: "Entwurf geändert. Vorhören stoppen und neu starten, um die Änderungen zu hören.", stopFailed: "Die aktuelle Performance konnte nicht gestoppt werden.",
    noNotes: "Dieses kontinuierliche Instrument spielt ohne MIDI-Noten.",
    knob: "Vertikal ziehen oder Pfeiltasten nutzen; Umschalt regelt fein. Doppelklick setzt zurück. Der Wert ist temporär.",
    integer: "Eine ganze Zahl eingeben oder Pfeiltasten nutzen. Eingabe oder Fokuswechsel übernimmt; Escape verwirft. Der Wert ist temporär.",
    bool: "Diese temporäre Einstellung ein- oder ausschalten.", nextNote: "Änderungen gelten ab der nächsten Note oder Phrase.",
    live: "Änderungen wirken sofort.", restart: "Vorhören stoppen und neu starten, um diesen Wert anzuwenden. Temporäre Werte bleiben erhalten.", unused: "Dieser Regler ist nicht verbunden."
  },
  french: {
    start: "Écouter", stop: "Arrêter l’écoute", preparing: "Préparation… · Annuler", stopping: "Arrêt…",
    controls: "Réglages d’écoute", keyboard: "Clavier d’écoute", lower: "Octave inférieure", higher: "Octave supérieure",
    mapping: "L’écoute nécessite une sortie principale stéréo. Les effets nécessitent une entrée principale stéréo pour l’instrument de test intégré.",
    stale: "Brouillon modifié. Arrêtez et relancez l’écoute pour entendre les modifications.", stopFailed: "Impossible d’arrêter la performance actuelle.",
    noNotes: "Cet instrument continu joue sans notes MIDI.",
    knob: "Glissez verticalement ou utilisez les flèches ; Maj affine le réglage. Double-cliquez pour réinitialiser. La valeur est temporaire.",
    integer: "Saisissez un entier ou utilisez les flèches. Entrée ou perte de focus valide ; Échap annule. La valeur est temporaire.",
    bool: "Activez ou désactivez ce réglage temporaire.", nextNote: "Les modifications s’appliquent à la prochaine note ou phrase.",
    live: "Les modifications s’appliquent en direct.", restart: "Arrêtez et relancez l’écoute pour appliquer cette valeur. Les valeurs temporaires sont conservées.", unused: "Ce réglage n’est pas connecté."
  },
  spanish: {
    start: "Escuchar", stop: "Detener escucha", preparing: "Preparando… · Cancelar", stopping: "Deteniendo…",
    controls: "Controles de escucha", keyboard: "Teclado de escucha", lower: "Bajar octava", higher: "Subir octava",
    mapping: "La escucha requiere una salida principal estéreo. Los efectos requieren una entrada principal estéreo para el instrumento de prueba integrado.",
    stale: "Borrador modificado. Detenga y reinicie la escucha para oír los cambios.", stopFailed: "No se pudo detener la interpretación actual.",
    noNotes: "Este instrumento continuo toca sin notas MIDI.",
    knob: "Arrastre verticalmente o use las flechas; Mayús ajusta con precisión. Doble clic restablece. El valor es temporal.",
    integer: "Introduzca un entero o use las flechas. Intro o perder el foco aplica; Escape cancela. El valor es temporal.",
    bool: "Active o desactive este ajuste temporal.", nextNote: "Los cambios se aplican a la siguiente nota o frase.",
    live: "Los cambios se aplican en vivo.", restart: "Detenga y reinicie la escucha para aplicar este valor. Se conservan los valores temporales.", unused: "Este control no está conectado."
  }
};
export const auditionCopy = (language: GuiLanguage) => copies[language];
