import type { GuiLanguage } from "../types";
import type { PerformanceDeviceNameError } from "./performanceDeviceNames";

interface NameCopy {
  edit: string;
  label: string;
  save: string;
  cancel: string;
  errors: Record<PerformanceDeviceNameError, string>;
}

export const performanceDeviceNameCopy: Record<GuiLanguage, NameCopy> = {
  english: {
    edit: "Rename", label: "Device name", save: "Save", cancel: "Cancel",
    errors: {
      empty: "Enter a name.", tooLong: "Use at most 65 characters.",
      html: "HTML and angle brackets (< >) are not allowed.",
      duplicate: "Another device in this performance already uses this name.", missing: "This device no longer exists."
    }
  },
  german: {
    edit: "Umbenennen", label: "Gerätename", save: "Speichern", cancel: "Abbrechen",
    errors: {
      empty: "Bitte einen Namen eingeben.", tooLong: "Höchstens 65 Zeichen verwenden.",
      html: "HTML und spitze Klammern (< >) sind nicht erlaubt.",
      duplicate: "Ein anderes Gerät in dieser Performance verwendet diesen Namen bereits.", missing: "Dieses Gerät existiert nicht mehr."
    }
  },
  french: {
    edit: "Renommer", label: "Nom de l’appareil", save: "Enregistrer", cancel: "Annuler",
    errors: {
      empty: "Saisissez un nom.", tooLong: "Utilisez au maximum 65 caractères.",
      html: "Le HTML et les chevrons (< >) ne sont pas autorisés.",
      duplicate: "Un autre appareil de cette performance utilise déjà ce nom.", missing: "Cet appareil n’existe plus."
    }
  },
  spanish: {
    edit: "Renombrar", label: "Nombre del dispositivo", save: "Guardar", cancel: "Cancelar",
    errors: {
      empty: "Introduce un nombre.", tooLong: "Utiliza como máximo 65 caracteres.",
      html: "No se permiten HTML ni corchetes angulares (< >).",
      duplicate: "Otro dispositivo de esta performance ya utiliza este nombre.", missing: "Este dispositivo ya no existe."
    }
  }
};
