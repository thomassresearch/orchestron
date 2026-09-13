import type { GuiLanguage, InstrumentType } from "../types";

export const INSTRUMENT_TYPES: InstrumentType[] = ["percussion", "melody", "bass", "effects_noise", "continuous"];

// Keep inference aligned with the backend and the shared fixture cases.
const RULES: Array<[InstrumentType, RegExp]> = [
  ["percussion", /\b(percussion|drums?|drumkit|drumset|kicks?|snares?|hi[ -]?hats?|cymbals?|claps?|toms?|tr[ -]?(808|909))\b/],
  ["bass", /\b(bass|bassline|sub[ -]?bass|tb[ -]?303)\b/],
  ["melody", /\b(melod(y|ic)|leads?|pads?|plucks?|organs?|pianos?|bells?|keys|brass|strings|supersaw|voice)\b/],
  ["effects_noise", /\b(effects?|fx|noise|risers?|sweeps?|lasers?|zaps?|bleeps?|chirps?|bubbles?|whooshes?|impacts?|textures?|drones?)\b/]
];

export function inferInstrumentType(name: string, description = "", alwaysOn = false): InstrumentType {
  if (alwaysOn) return "continuous";
  for (const text of [name, description]) {
    const normalized = text.toLowerCase().replace(/_/g, " ");
    for (const [type, pattern] of RULES) {
      if (pattern.test(normalized)) return type;
    }
  }
  return "melody";
}

export function instrumentMetadata(raw: {
  instrumentType?: unknown;
  instrument_type?: unknown;
  name?: unknown;
  description?: unknown;
  alwaysOn?: unknown;
  always_on?: unknown;
}): { instrument_type: InstrumentType; always_on: boolean } {
  const explicit = raw.instrumentType !== undefined ? raw.instrumentType : raw.instrument_type;
  if (explicit !== undefined && !INSTRUMENT_TYPES.includes(explicit as InstrumentType)) {
    throw new Error(`Unsupported instrument type: ${String(explicit)}`);
  }
  const instrumentType = (explicit as InstrumentType | undefined) ?? inferInstrumentType(
    typeof raw.name === "string" ? raw.name : "",
    typeof raw.description === "string" ? raw.description : "",
    raw.alwaysOn === true || raw.always_on === true
  );
  return { instrument_type: instrumentType, always_on: instrumentType === "continuous" };
}

const COPY: Record<GuiLanguage, {
  type: string;
  types: Record<InstrumentType, string>;
  search: string;
  guidance: string;
  noMatches: string;
  empty: string;
}> = {
  english: {
    type: "Instrument Type",
    types: { percussion: "Percussion", melody: "Melody", bass: "Bass", effects_noise: "Effects / Noise", continuous: "Continuous (always-on)" },
    search: "Search patches", guidance: "Type at least 4 characters to search names and descriptions.",
    noMatches: "No matching patches.", empty: "No patches available to load."
  },
  german: {
    type: "Instrumententyp",
    types: { percussion: "Perkussion", melody: "Melodie", bass: "Bass", effects_noise: "Effekte / Geräusche", continuous: "Kontinuierlich (immer an)" },
    search: "Patches suchen", guidance: "Mindestens 4 Zeichen eingeben, um Namen und Beschreibungen zu durchsuchen.",
    noMatches: "Keine passenden Patches.", empty: "Keine Patches zum Laden verfügbar."
  },
  french: {
    type: "Type d’instrument",
    types: { percussion: "Percussion", melody: "Mélodie", bass: "Basse", effects_noise: "Effets / Bruit", continuous: "Continu (toujours actif)" },
    search: "Rechercher des patchs", guidance: "Saisissez au moins 4 caractères pour rechercher dans les noms et descriptions.",
    noMatches: "Aucun patch correspondant.", empty: "Aucun patch disponible à charger."
  },
  spanish: {
    type: "Tipo de instrumento",
    types: { percussion: "Percusión", melody: "Melodía", bass: "Bajo", effects_noise: "Efectos / Ruido", continuous: "Continuo (siempre activo)" },
    search: "Buscar patches", guidance: "Escribe al menos 4 caracteres para buscar en nombres y descripciones.",
    noMatches: "No hay patches coincidentes.", empty: "No hay patches disponibles para cargar."
  }
};

export function instrumentTypeCopy(language: GuiLanguage) {
  return COPY[language];
}
