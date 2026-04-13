import type { JSX } from "react";
import type { GuiLanguage, HelpDocId } from "../types";

import { getHelpDocument } from "../lib/documentation";
import { documentationUiCopy } from "../lib/documentationUi";
import { DocumentationModalFrame } from "./DocumentationModalFrame";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface HelpDocumentationModalProps {
  helpDocId: HelpDocId;
  guiLanguage: GuiLanguage;
  onClose: () => void;
}

export function HelpDocumentationModal({ helpDocId, guiLanguage, onClose }: HelpDocumentationModalProps): JSX.Element {
  const ui = documentationUiCopy(guiLanguage);
  const helpDocument = getHelpDocument(helpDocId, guiLanguage);

  return (
    <DocumentationModalFrame
      ariaLabel={ui.help}
      title={helpDocument.title}
      subtitle={ui.help}
      closeLabel={ui.close}
      onClose={onClose}
    >
      <MarkdownRenderer markdown={helpDocument.markdown} />
    </DocumentationModalFrame>
  );
}
