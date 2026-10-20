import type { GuiLanguage } from "../types";
import type { InputValueState } from "./inputValue";

const copy = {
  english: {
    formula: "Saved formula", connections: "Connected signals", parameter: "Stored value", default: "Catalog default", unset: "Unset",
    edit: "Double-click to edit the input value or formula.", fallback: "Inactive stored fallback", afterReset: "After reset",
    reset: "Reset input", save: "Save input", value: "Value or formula", string: "Text value", number: "Numeric value",
    numberError: "Enter a finite numeric literal.", connectedLiteral: "Disconnect this input before editing its literal value.",
    managed: "Edit this channel name in Stereo Input / Stereo Output configuration.", coefficients: "Edit the inline coefficient list.",
    required: "Required input will be unset.", title: "Input value and formula"
  },
  german: {
    formula: "Gespeicherte Formel", connections: "Verbundene Signale", parameter: "Gespeicherter Wert", default: "Katalogstandard", unset: "Nicht gesetzt",
    edit: "Doppelklick zum Bearbeiten des Eingangswerts oder der Formel.", fallback: "Inaktiver gespeicherter Ersatzwert", afterReset: "Nach dem Zurücksetzen",
    reset: "Eingang zurücksetzen", save: "Eingang speichern", value: "Wert oder Formel", string: "Textwert", number: "Zahlenwert",
    numberError: "Eine endliche Zahl eingeben.", connectedLiteral: "Die Verbindung vor dem Bearbeiten des festen Werts entfernen.",
    managed: "Diesen Kanalnamen in der Konfiguration von Stereo Input / Stereo Output bearbeiten.", coefficients: "Die Koeffizientenliste direkt im Node bearbeiten.",
    required: "Der erforderliche Eingang ist danach nicht gesetzt.", title: "Eingangswert und Formel"
  },
  french: {
    formula: "Formule enregistrée", connections: "Signaux connectés", parameter: "Valeur enregistrée", default: "Valeur par défaut du catalogue", unset: "Non défini",
    edit: "Double-cliquez pour modifier la valeur ou la formule de l’entrée.", fallback: "Valeur de repli enregistrée inactive", afterReset: "Après réinitialisation",
    reset: "Réinitialiser l’entrée", save: "Enregistrer l’entrée", value: "Valeur ou formule", string: "Valeur texte", number: "Valeur numérique",
    numberError: "Saisissez une valeur numérique finie.", connectedLiteral: "Déconnectez cette entrée avant de modifier sa valeur littérale.",
    managed: "Modifiez ce nom de canal dans la configuration Stereo Input / Stereo Output.", coefficients: "Modifiez la liste des coefficients dans le nœud.",
    required: "L’entrée obligatoire ne sera plus définie.", title: "Valeur et formule de l’entrée"
  },
  spanish: {
    formula: "Fórmula guardada", connections: "Señales conectadas", parameter: "Valor guardado", default: "Valor predeterminado del catálogo", unset: "Sin definir",
    edit: "Haz doble clic para editar el valor o la fórmula de la entrada.", fallback: "Valor de respaldo guardado inactivo", afterReset: "Después de restablecer",
    reset: "Restablecer entrada", save: "Guardar entrada", value: "Valor o fórmula", string: "Valor de texto", number: "Valor numérico",
    numberError: "Introduce un valor numérico finito.", connectedLiteral: "Desconecta esta entrada antes de editar su valor literal.",
    managed: "Edita este nombre de canal en la configuración de Stereo Input / Stereo Output.", coefficients: "Edita la lista de coeficientes en el nodo.",
    required: "La entrada obligatoria quedará sin definir.", title: "Valor y fórmula de entrada"
  }
};

export const inputValueCopy = (language: GuiLanguage) => copy[language];
export function describeInputValue(state: InputValueState, language: GuiLanguage): string {
  const labels = copy[language];
  const value = state.source === "parameter" ? String(state.storedValue) : state.expression;
  return `${labels[state.source]}${state.source === "unset" ? "" : `: ${value}`}`;
}
