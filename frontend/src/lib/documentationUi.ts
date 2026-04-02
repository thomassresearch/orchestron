import type { GuiLanguage } from "../types";

import { normalizeGuiLanguage } from "./guiLanguage";

export interface DocumentationUiCopy {
  showDocumentation: string;
  help: string;
  close: string;
  openCsoundReference: string;
  opcodeDocumentation: string;
  noOpcodeDocumentation: string;
}

const DOCUMENTATION_UI_COPY: Record<GuiLanguage, DocumentationUiCopy> = {
  english: {
    showDocumentation: "Show documentation",
    help: "Help",
    close: "Close",
    openCsoundReference: "Open Csound Reference",
    opcodeDocumentation: "Opcode Documentation",
    noOpcodeDocumentation: "No documentation markdown available for this opcode."
  },
  german: {
    showDocumentation: "Dokumentation anzeigen",
    help: "Hilfe",
    close: "Schließen",
    openCsoundReference: "Csound-Referenz öffnen",
    opcodeDocumentation: "Opcode-Dokumentation",
    noOpcodeDocumentation: "Keine Markdown-Dokumentation für dieses Opcode verfügbar."
  },
  french: {
    showDocumentation: "Afficher la documentation",
    help: "Aide",
    close: "Fermer",
    openCsoundReference: "Ouvrir la référence Csound",
    opcodeDocumentation: "Documentation Opcode",
    noOpcodeDocumentation: "Aucune documentation markdown disponible pour cet opcode."
  },
  spanish: {
    showDocumentation: "Mostrar documentación",
    help: "Ayuda",
    close: "Cerrar",
    openCsoundReference: "Abrir referencia de Csound",
    opcodeDocumentation: "Documentación de Opcode",
    noOpcodeDocumentation: "No hay documentación markdown disponible para este opcode."
  }
};

export function documentationUiCopy(language: GuiLanguage): DocumentationUiCopy {
  const normalized = normalizeGuiLanguage(language);
  return DOCUMENTATION_UI_COPY[normalized];
}
