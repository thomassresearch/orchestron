import type { GuiLanguage, OpcodeSpec, PortSpec, SignalType } from "../types";

import { normalizeGuiLanguage } from "./guiLanguage";
import opcodeDocDetails from "./opcodeDocDetails.json";

type LocalizedOpcodeCopy = {
  description: string;
  category: string;
  syntax: string;
  tags: string;
  inputs: string;
  outputs: string;
  noInputs: string;
  noOutputs: string;
  reference: string;
  optional: string;
  defaultValue: string;
  accepts: string;
};

const LOCALIZED_OPCODE_COPY: Record<GuiLanguage, LocalizedOpcodeCopy> = {
  english: {
    description: "Description",
    category: "Category",
    syntax: "Syntax",
    tags: "Tags",
    inputs: "Inputs",
    outputs: "Outputs",
    noInputs: "none",
    noOutputs: "none (sink opcode)",
    reference: "Reference",
    optional: "optional",
    defaultValue: "default",
    accepts: "accepts"
  },
  german: {
    description: "Beschreibung",
    category: "Kategorie",
    syntax: "Syntax",
    tags: "Tags",
    inputs: "Eingänge",
    outputs: "Ausgänge",
    noInputs: "keine",
    noOutputs: "keine (Sink-Opcode)",
    reference: "Referenz",
    optional: "optional",
    defaultValue: "default",
    accepts: "akzeptiert"
  },
  french: {
    description: "Description",
    category: "Catégorie",
    syntax: "Syntax",
    tags: "Tags",
    inputs: "Entrées",
    outputs: "Sorties",
    noInputs: "aucune",
    noOutputs: "aucune (opcode sink)",
    reference: "Référence",
    optional: "optionnel",
    defaultValue: "défaut",
    accepts: "accepte"
  },
  spanish: {
    description: "Descripción",
    category: "Categoría",
    syntax: "Syntax",
    tags: "Etiquetas",
    inputs: "Entradas",
    outputs: "Salidas",
    noInputs: "ninguna",
    noOutputs: "ninguna (opcode sink)",
    reference: "Referencia",
    optional: "opcional",
    defaultValue: "por defecto",
    accepts: "acepta"
  }
};

type LocalizedOpcodeDocText = Record<GuiLanguage, string>;

type LocalizedOpcodeDocDetails = {
  description: LocalizedOpcodeDocText;
  inputs: Record<string, LocalizedOpcodeDocText>;
  outputs: Record<string, LocalizedOpcodeDocText>;
};

const OPCODE_DOC_DETAILS: Record<string, LocalizedOpcodeDocDetails> = opcodeDocDetails;

const SIGNAL_TYPE_LABELS: Record<GuiLanguage, Record<SignalType, string>> = {
  english: {
    a: "audio-rate",
    k: "control-rate",
    i: "init-rate",
    S: "string-rate",
    f: "phase-vocoder frame signal"
  },
  german: {
    a: "audio-rate",
    k: "Kontrollrate",
    i: "init-rate",
    S: "string-rate",
    f: "Phase-Vocoder-Frame-Signal"
  },
  french: {
    a: "taux audio",
    k: "taux contrôle",
    i: "taux init",
    S: "taux chaîne",
    f: "signal de trame phase-vocodeur"
  },
  spanish: {
    a: "tasa de audio",
    k: "tasa de control",
    i: "tasa init",
    S: "tasa de cadena",
    f: "señal de trama de vocoder de fase"
  }
};

function localizedPortDescription(opcode: OpcodeSpec, port: PortSpec, language: GuiLanguage, isOutput: boolean): string {
  const details = OPCODE_DOC_DETAILS[opcode.name];
  const localized = (isOutput ? details?.outputs?.[port.id] : details?.inputs?.[port.id])?.[language];
  if (localized && localized.trim().length > 0) {
    return localized;
  }
  if (port.description.trim().length > 0) {
    return port.description.trim();
  }
  return port.name;
}

function formatPortLine(opcode: OpcodeSpec, port: PortSpec, language: GuiLanguage, isOutput: boolean): string {
  const copy = LOCALIZED_OPCODE_COPY[language];
  const signalLabel = SIGNAL_TYPE_LABELS[language][port.signal_type];
  const qualifiers: string[] = [signalLabel];

  if (!port.required) {
    qualifiers.push(copy.optional);
  }

  if (port.default !== undefined && port.default !== null) {
    qualifiers.push(`${copy.defaultValue} \`${String(port.default)}\``);
  }

  const accepted = Array.isArray(port.accepted_signal_types)
    ? port.accepted_signal_types.filter((entry) => Boolean(entry))
    : [];
  if (accepted.length > 0) {
    qualifiers.push(`${copy.accepts} ${accepted.map((entry) => `\`${entry}\``).join(", ")}`);
  }

  const detail = localizedPortDescription(opcode, port, language, isOutput);
  return `- \`${port.id}\` (${qualifiers.join("; ")}): ${detail}`;
}

function localizedOpcodeDescription(opcode: OpcodeSpec, language: GuiLanguage): string {
  const localized = OPCODE_DOC_DETAILS[opcode.name]?.description?.[language];
  if (localized && localized.trim().length > 0) {
    return localized;
  }
  return opcode.description.trim().length > 0 ? opcode.description : "-";
}

function buildGeneratedOpcodeMarkdown(opcode: OpcodeSpec, language: GuiLanguage): string {
  const copy = LOCALIZED_OPCODE_COPY[language];
  const lines: string[] = [];

  lines.push(`### \`${opcode.name}\``);
  lines.push("");
  lines.push(`**${copy.description}:** ${localizedOpcodeDescription(opcode, language)}`);
  lines.push(`**${copy.category}:** \`${opcode.category}\``);

  if (opcode.template.trim().length > 0) {
    lines.push("");
    lines.push(`**${copy.syntax}**`);
    lines.push(`- \`${opcode.template}\``);
  }

  if (opcode.tags.length > 0) {
    lines.push("");
    lines.push(`**${copy.tags}:** ${opcode.tags.map((tag) => `\`${tag}\``).join(", ")}`);
  }

  lines.push("");
  lines.push(`**${copy.inputs}**`);
  if (opcode.inputs.length === 0) {
    lines.push(`- ${copy.noInputs}`);
  } else {
    for (const input of opcode.inputs) {
      lines.push(formatPortLine(opcode, input, language, false));
    }
  }

  lines.push("");
  lines.push(`**${copy.outputs}**`);
  if (opcode.outputs.length === 0) {
    lines.push(`- ${copy.noOutputs}`);
  } else {
    for (const output of opcode.outputs) {
      lines.push(formatPortLine(opcode, output, language, true));
    }
  }

  lines.push("");
  lines.push(`**${copy.reference}**`);
  if (opcode.documentation_url.trim().length > 0) {
    lines.push(`- [Csound manual](${opcode.documentation_url})`);
  } else {
    lines.push("- [Csound Part Reference](https://csound.com/docs/manual/PartReference.html)");
  }

  return lines.join("\n");
}

export function localizedOpcodeMarkdown(opcode: OpcodeSpec, language: GuiLanguage): string {
  return buildGeneratedOpcodeMarkdown(opcode, normalizeGuiLanguage(language));
}
