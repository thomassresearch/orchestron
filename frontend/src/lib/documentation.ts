import type { GuiLanguage, HelpDocId } from "../types";

import { configHelpAppendices, configHelpDocuments } from "./helpDocumentationConfig";
import { feedbackRoutingHelp } from "./helpDocumentationAudio";
import { instrumentHelpAppendices, instrumentHelpDocuments } from "./helpDocumentationInstrument";
import { performHelpDocuments } from "./helpDocumentationPerform";
import { sequencerHelpAppendices, sequencerHelpDocuments } from "./helpDocumentationSequencer";
import { normalizeGuiLanguage } from "./guiLanguage";
import type { HelpDocument, HelpDocumentAppendixCatalog, HelpDocumentCatalog } from "./helpDocumentationTypes";

const HELP_DOCUMENTS: HelpDocumentCatalog = {
  ...instrumentHelpDocuments,
  ...performHelpDocuments,
  ...sequencerHelpDocuments,
  ...configHelpDocuments
};

const HELP_DOC_SPECIFIC_APPENDIX: HelpDocumentAppendixCatalog = {
  perform_routing: feedbackRoutingHelp,
  ...instrumentHelpAppendices,
  ...sequencerHelpAppendices,
  ...configHelpAppendices
};

export function getHelpDocument(helpDocId: HelpDocId, language: GuiLanguage): HelpDocument {
  const normalized = normalizeGuiLanguage(language);
  const base = HELP_DOCUMENTS[helpDocId][normalized];
  const specificAppendix = HELP_DOC_SPECIFIC_APPENDIX[helpDocId]?.[normalized] ?? "";

  const markdown = [base.markdown.trim(), specificAppendix.trim()]
    .filter((section) => section.length > 0)
    .join("\n\n");

  return {
    title: base.title,
    markdown
  };
}

export type { HelpDocument } from "./helpDocumentationTypes";
