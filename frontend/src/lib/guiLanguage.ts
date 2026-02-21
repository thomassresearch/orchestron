import type { GuiLanguage } from "../types";

export const GUI_LANGUAGE_OPTIONS: Array<{ value: GuiLanguage; label: string }> = [
  { value: "english", label: "English" },
  { value: "german", label: "German" },
  { value: "french", label: "French" },
  { value: "spanish", label: "Spanish" }
];

export const GUI_LANGUAGE_LABELS: Record<GuiLanguage, Record<GuiLanguage, string>> = {
  english: {
    english: "English",
    german: "German",
    french: "French",
    spanish: "Spanish"
  },
  german: {
    english: "Englisch",
    german: "Deutsch",
    french: "Franzoesisch",
    spanish: "Spanisch"
  },
  french: {
    english: "Anglais",
    german: "Allemand",
    french: "Francais",
    spanish: "Espagnol"
  },
  spanish: {
    english: "Ingles",
    german: "Aleman",
    french: "Frances",
    spanish: "Espanol"
  }
};

const GUI_LANGUAGE_VALUES = new Set<GuiLanguage>(GUI_LANGUAGE_OPTIONS.map((option) => option.value));

export function normalizeGuiLanguage(value: unknown): GuiLanguage {
  if (typeof value !== "string") {
    return "english";
  }

  const candidate = value.toLowerCase();
  if (GUI_LANGUAGE_VALUES.has(candidate as GuiLanguage)) {
    return candidate as GuiLanguage;
  }

  return "english";
}
