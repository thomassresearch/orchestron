import type { GuiLanguage } from "../types";

const english = {
  title: "Performance controller", configure: "Configure performance controller", node: "Node",
  min: "Minimum", max: "Maximum", default: "Default", scale: "Scale", label: "Label",
  linear: "Linear", logarithmic: "Logarithmic", save: "Save", close: "Close",
  finite: "Minimum, maximum and default must be finite numbers.", range: "Minimum must be smaller than maximum.",
  defaultRange: "Default must be within the range.", positive: "Logarithmic minimum must be greater than zero.",
  labelRequired: "Enter a label of 1–128 characters.", invalid: "Invalid controller configuration. Edit the patch to correct it.",
  help: "Drag vertically or use arrow keys; Shift adjusts finely. Double-click to reset to the patch default. Changes apply to new notes. Save Performance stores your settings.",
  continuous: "Changes take effect after restarting the rack for continuous instruments.",
  reconciled: "Controller settings were adjusted to match the updated patch ranges or removed controllers.",
  sync: "Performance controller update failed", retry: "Retry"
};
type Copy = Record<keyof typeof english, string>;
const copies: Record<GuiLanguage, Copy> = {
  english,
  german: {
    title: "Performance-Regler", configure: "Performance-Regler konfigurieren", node: "Knoten",
    min: "Minimum", max: "Maximum", default: "Standardwert", scale: "Skala", label: "Beschriftung",
    linear: "Linear", logarithmic: "Logarithmisch", save: "Speichern", close: "Schließen",
    finite: "Minimum, Maximum und Standardwert müssen endliche Zahlen sein.", range: "Das Minimum muss kleiner als das Maximum sein.",
    defaultRange: "Der Standardwert muss im Wertebereich liegen.", positive: "Das logarithmische Minimum muss größer als null sein.",
    labelRequired: "Eine Beschriftung mit 1–128 Zeichen eingeben.", invalid: "Ungültige Reglerkonfiguration. Bitte im Patch korrigieren.",
    help: "Vertikal ziehen oder Pfeiltasten verwenden; Umschalt erlaubt Feineinstellung. Doppelklick setzt auf den Patch-Standard zurück. Änderungen gelten für neue Noten. Performance speichern sichert die Einstellungen.",
    continuous: "Bei kontinuierlichen Instrumenten gelten Änderungen nach einem Neustart des Racks.",
    reconciled: "Reglereinstellungen wurden an geänderte Wertebereiche oder entfernte Regler im Patch angepasst.",
    sync: "Performance-Regler konnte nicht aktualisiert werden", retry: "Erneut versuchen"
  },
  french: {
    title: "Réglage de performance", configure: "Configurer le réglage de performance", node: "Nœud",
    min: "Minimum", max: "Maximum", default: "Valeur par défaut", scale: "Échelle", label: "Libellé",
    linear: "Linéaire", logarithmic: "Logarithmique", save: "Enregistrer", close: "Fermer",
    finite: "Le minimum, le maximum et la valeur par défaut doivent être des nombres finis.", range: "Le minimum doit être inférieur au maximum.",
    defaultRange: "La valeur par défaut doit être dans la plage.", positive: "Le minimum logarithmique doit être supérieur à zéro.",
    labelRequired: "Saisissez un libellé de 1 à 128 caractères.", invalid: "Configuration invalide. Corrigez le réglage dans le patch.",
    help: "Glissez verticalement ou utilisez les flèches ; Maj permet un réglage fin. Double-cliquez pour rétablir la valeur par défaut du patch. Les changements concernent les nouvelles notes. Enregistrer la performance conserve vos réglages.",
    continuous: "Pour les instruments continus, les changements prennent effet après le redémarrage du rack.",
    reconciled: "Les réglages ont été adaptés aux plages modifiées ou aux contrôleurs supprimés du patch.",
    sync: "Échec de la mise à jour du réglage de performance", retry: "Réessayer"
  },
  spanish: {
    title: "Control de interpretación", configure: "Configurar control de interpretación", node: "Nodo",
    min: "Mínimo", max: "Máximo", default: "Valor predeterminado", scale: "Escala", label: "Etiqueta",
    linear: "Lineal", logarithmic: "Logarítmica", save: "Guardar", close: "Cerrar",
    finite: "El mínimo, máximo y valor predeterminado deben ser números finitos.", range: "El mínimo debe ser menor que el máximo.",
    defaultRange: "El valor predeterminado debe estar dentro del rango.", positive: "El mínimo logarítmico debe ser mayor que cero.",
    labelRequired: "Introduzca una etiqueta de 1 a 128 caracteres.", invalid: "Configuración no válida. Corríjala en el patch.",
    help: "Arrastre verticalmente o use las flechas; Mayús permite un ajuste fino. Haga doble clic para restablecer el valor del patch. Los cambios se aplican a las notas nuevas. Guardar interpretación conserva los ajustes.",
    continuous: "En instrumentos continuos, los cambios se aplican después de reiniciar el rack.",
    reconciled: "Los ajustes se adaptaron a los rangos modificados o controles eliminados del patch.",
    sync: "No se pudo actualizar el control de interpretación", retry: "Reintentar"
  }
};
export const performanceControllerCopy = (language: GuiLanguage) => copies[language];
