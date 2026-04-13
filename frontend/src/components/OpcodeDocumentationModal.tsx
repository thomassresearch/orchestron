import type { JSX } from "react";
import type { GuiLanguage, OpcodeSpec } from "../types";
import { localizedOpcodeMarkdown } from "../lib/opcodeDocumentation";
import { documentationUiCopy } from "../lib/documentationUi";
import { DocumentationModalFrame } from "./DocumentationModalFrame";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface OpcodeDocumentationModalProps {
  opcode: OpcodeSpec;
  guiLanguage: GuiLanguage;
  onClose: () => void;
}

export function OpcodeDocumentationModal({ opcode, guiLanguage, onClose }: OpcodeDocumentationModalProps): JSX.Element {
  const ui = documentationUiCopy(guiLanguage);
  const markdown = localizedOpcodeMarkdown(opcode, guiLanguage);

  return (
    <DocumentationModalFrame
      ariaLabel={`${opcode.name} ${ui.opcodeDocumentation}`}
      title={opcode.name}
      subtitle={ui.opcodeDocumentation}
      closeLabel={ui.close}
      onClose={onClose}
      actions={
        opcode.documentation_url ? (
          <a
            href={opcode.documentation_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300 transition hover:bg-cyan-500/20"
          >
            {ui.openCsoundReference}
          </a>
        ) : null
      }
    >
      {markdown.trim().length > 0 ? (
        <MarkdownRenderer markdown={markdown} />
      ) : (
        <p className="text-sm text-slate-300">{ui.noOpcodeDocumentation}</p>
      )}
    </DocumentationModalFrame>
  );
}
