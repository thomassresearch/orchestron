import type { GuiLanguage } from "../types";

const english = {
  newInstrument: "New instrument", details: "Patch details", file: "File", addOpcode: "Add opcode",
  noMatches: "No matching opcodes", editFormula: "Edit formula", saved: "Saved to library",
  unsaved: "Unsaved draft", changed: "Unsaved changes", checking: "Checking library…", unknown: "Library status unavailable",
  close: "Close catalog", results: "Opcode results"
};
const copy: Record<GuiLanguage, typeof english> = {
  english,
  german: {
    newInstrument: "Neues Instrument", details: "Patch-Details", file: "Datei", addOpcode: "Opcode hinzufügen",
    noMatches: "Keine passenden Opcodes", editFormula: "Formel bearbeiten", saved: "In Bibliothek gespeichert",
    unsaved: "Ungespeicherter Entwurf", changed: "Ungespeicherte Änderungen", checking: "Bibliothek wird geprüft…", unknown: "Bibliotheksstatus unbekannt",
    close: "Katalog schließen", results: "Opcode-Ergebnisse"
  },
  french: {
    newInstrument: "Nouvel instrument", details: "Détails du patch", file: "Fichier", addOpcode: "Ajouter un opcode",
    noMatches: "Aucun opcode correspondant", editFormula: "Modifier la formule", saved: "Enregistré en bibliothèque",
    unsaved: "Brouillon non enregistré", changed: "Modifications non enregistrées", checking: "Vérification de la bibliothèque…", unknown: "État de la bibliothèque inconnu",
    close: "Fermer le catalogue", results: "Résultats du catalogue"
  },
  spanish: {
    newInstrument: "Nuevo instrumento", details: "Detalles del patch", file: "Archivo", addOpcode: "Añadir opcode",
    noMatches: "Ningún opcode coincide", editFormula: "Editar fórmula", saved: "Guardado en la biblioteca",
    unsaved: "Borrador sin guardar", changed: "Cambios sin guardar", checking: "Consultando biblioteca…", unknown: "Estado de biblioteca desconocido",
    close: "Cerrar catálogo", results: "Resultados de opcodes"
  }
};
export const instrumentDesignCopy = (language: GuiLanguage) => copy[language];
