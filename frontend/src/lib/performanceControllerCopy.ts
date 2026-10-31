import type { GuiLanguage } from "../types";

const english = {
  type: "Type", float: "Float", integer: "Integer", bool: "Bool", on: "On", off: "Off",
  increase: "Increase", decrease: "Decrease", reset: "Reset to patch default",
  invalidType: "Choose Float, Integer or Bool.", linearOnly: "Integer and Bool controllers require linear scale.",
  integerRequired: "Minimum, maximum and default must be safe integers (−9007199254740991 to 9007199254740991).",
  boolRequired: "Bool requires minimum 0, maximum 1 and default 0 or 1.",
  integerHelp: "Use the triangles or arrow keys to step by 1, or enter a whole number. Home/End selects the limits. Reset removes the override. Changes apply to new notes.",
  boolHelp: "Toggle On (1) or Off (0). Reset removes the override. Changes apply to new notes.",
  title: "Performance controller", configure: "Configure performance controller", node: "Node",
  min: "Minimum", max: "Maximum", default: "Default", scale: "Scale", label: "Label",
  linear: "Linear", logarithmic: "Logarithmic", save: "Save", close: "Close",
  finite: "Minimum, maximum and default must be finite numbers.", range: "Minimum must be smaller than maximum.",
  defaultRange: "Default must be within the range.", positive: "Logarithmic minimum must be greater than zero.",
  labelRequired: "Enter a label of 1–128 characters.", invalid: "Invalid controller configuration. Edit the patch to correct it.",
  help: "Drag vertically or use arrow keys; Shift adjusts finely. Double-click to reset to the patch default. Changes apply to new notes. Save Performance stores your settings.",
  continuous: "Changes take effect after restarting the rack for continuous instruments.",
  reconciled: "Controller settings were adjusted to match the updated patch types, ranges or removed controllers.",
  sync: "Performance controller update failed", retry: "Retry"
};
type Copy = Record<keyof typeof english, string>;
const copies: Record<GuiLanguage, Copy> = {
  english,
  german: {
    type: "Typ", float: "Fließkomma", integer: "Ganzzahl", bool: "Bool", on: "Ein", off: "Aus",
    increase: "Erhöhen", decrease: "Verringern", reset: "Auf Patch-Standard zurücksetzen",
    invalidType: "Fließkomma, Ganzzahl oder Bool wählen.", linearOnly: "Ganzzahl- und Bool-Regler benötigen eine lineare Skala.",
    integerRequired: "Minimum, Maximum und Standardwert müssen sichere Ganzzahlen sein (−9007199254740991 bis 9007199254740991).",
    boolRequired: "Bool benötigt Minimum 0, Maximum 1 und Standardwert 0 oder 1.",
    integerHelp: "Dreiecke oder Pfeiltasten ändern den Wert um 1; ganze Zahlen können direkt eingegeben werden. Pos1/Ende wählt die Grenzen. Zurücksetzen entfernt den eigenen Wert. Änderungen gelten für neue Noten.",
    boolHelp: "Zwischen Ein (1) und Aus (0) umschalten. Zurücksetzen entfernt den eigenen Wert. Änderungen gelten für neue Noten.",
    title: "Performance-Regler", configure: "Performance-Regler konfigurieren", node: "Knoten",
    min: "Minimum", max: "Maximum", default: "Standardwert", scale: "Skala", label: "Beschriftung",
    linear: "Linear", logarithmic: "Logarithmisch", save: "Speichern", close: "Schließen",
    finite: "Minimum, Maximum und Standardwert müssen endliche Zahlen sein.", range: "Das Minimum muss kleiner als das Maximum sein.",
    defaultRange: "Der Standardwert muss im Wertebereich liegen.", positive: "Das logarithmische Minimum muss größer als null sein.",
    labelRequired: "Eine Beschriftung mit 1–128 Zeichen eingeben.", invalid: "Ungültige Reglerkonfiguration. Bitte im Patch korrigieren.",
    help: "Vertikal ziehen oder Pfeiltasten verwenden; Umschalt erlaubt Feineinstellung. Doppelklick setzt auf den Patch-Standard zurück. Änderungen gelten für neue Noten. Performance speichern sichert die Einstellungen.",
    continuous: "Bei kontinuierlichen Instrumenten gelten Änderungen nach einem Neustart des Racks.",
    reconciled: "Reglereinstellungen wurden an geänderte Typen, Wertebereiche oder entfernte Regler im Patch angepasst.",
    sync: "Performance-Regler konnte nicht aktualisiert werden", retry: "Erneut versuchen"
  },
  french: {
    type: "Type", float: "Décimal", integer: "Entier", bool: "Booléen", on: "Activé", off: "Désactivé",
    increase: "Augmenter", decrease: "Diminuer", reset: "Rétablir la valeur du patch",
    invalidType: "Choisissez Décimal, Entier ou Booléen.", linearOnly: "Les réglages entiers et booléens exigent une échelle linéaire.",
    integerRequired: "Le minimum, le maximum et la valeur par défaut doivent être des entiers sûrs (−9007199254740991 à 9007199254740991).",
    boolRequired: "Booléen exige un minimum de 0, un maximum de 1 et une valeur par défaut de 0 ou 1.",
    integerHelp: "Utilisez les triangles ou les flèches pour avancer de 1, ou saisissez un entier. Début/Fin choisit les limites. Réinitialiser supprime la valeur personnalisée. Les changements concernent les nouvelles notes.",
    boolHelp: "Basculez entre Activé (1) et Désactivé (0). Réinitialiser supprime la valeur personnalisée. Les changements concernent les nouvelles notes.",
    title: "Réglage de performance", configure: "Configurer le réglage de performance", node: "Nœud",
    min: "Minimum", max: "Maximum", default: "Valeur par défaut", scale: "Échelle", label: "Libellé",
    linear: "Linéaire", logarithmic: "Logarithmique", save: "Enregistrer", close: "Fermer",
    finite: "Le minimum, le maximum et la valeur par défaut doivent être des nombres finis.", range: "Le minimum doit être inférieur au maximum.",
    defaultRange: "La valeur par défaut doit être dans la plage.", positive: "Le minimum logarithmique doit être supérieur à zéro.",
    labelRequired: "Saisissez un libellé de 1 à 128 caractères.", invalid: "Configuration invalide. Corrigez le réglage dans le patch.",
    help: "Glissez verticalement ou utilisez les flèches ; Maj permet un réglage fin. Double-cliquez pour rétablir la valeur par défaut du patch. Les changements concernent les nouvelles notes. Enregistrer la performance conserve vos réglages.",
    continuous: "Pour les instruments continus, les changements prennent effet après le redémarrage du rack.",
    reconciled: "Les réglages ont été adaptés aux types ou plages modifiés et aux contrôleurs supprimés du patch.",
    sync: "Échec de la mise à jour du réglage de performance", retry: "Réessayer"
  },
  spanish: {
    type: "Tipo", float: "Decimal", integer: "Entero", bool: "Booleano", on: "Activado", off: "Desactivado",
    increase: "Aumentar", decrease: "Disminuir", reset: "Restablecer el valor del patch",
    invalidType: "Elija Decimal, Entero o Booleano.", linearOnly: "Los controles enteros y booleanos requieren una escala lineal.",
    integerRequired: "El mínimo, máximo y valor predeterminado deben ser enteros seguros (−9007199254740991 a 9007199254740991).",
    boolRequired: "Booleano requiere mínimo 0, máximo 1 y valor predeterminado 0 o 1.",
    integerHelp: "Use los triángulos o las flechas para cambiar de 1 en 1, o introduzca un entero. Inicio/Fin elige los límites. Restablecer elimina el valor personalizado. Los cambios se aplican a las notas nuevas.",
    boolHelp: "Alterne entre Activado (1) y Desactivado (0). Restablecer elimina el valor personalizado. Los cambios se aplican a las notas nuevas.",
    title: "Control de interpretación", configure: "Configurar control de interpretación", node: "Nodo",
    min: "Mínimo", max: "Máximo", default: "Valor predeterminado", scale: "Escala", label: "Etiqueta",
    linear: "Lineal", logarithmic: "Logarítmica", save: "Guardar", close: "Cerrar",
    finite: "El mínimo, máximo y valor predeterminado deben ser números finitos.", range: "El mínimo debe ser menor que el máximo.",
    defaultRange: "El valor predeterminado debe estar dentro del rango.", positive: "El mínimo logarítmico debe ser mayor que cero.",
    labelRequired: "Introduzca una etiqueta de 1 a 128 caracteres.", invalid: "Configuración no válida. Corríjala en el patch.",
    help: "Arrastre verticalmente o use las flechas; Mayús permite un ajuste fino. Haga doble clic para restablecer el valor del patch. Los cambios se aplican a las notas nuevas. Guardar interpretación conserva los ajustes.",
    continuous: "En instrumentos continuos, los cambios se aplican después de reiniciar el rack.",
    reconciled: "Los ajustes se adaptaron a los tipos o rangos modificados y controles eliminados del patch.",
    sync: "No se pudo actualizar el control de interpretación", retry: "Reintentar"
  }
};
export const performanceControllerCopy = (language: GuiLanguage) => copies[language];
