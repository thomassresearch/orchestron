import type { GuiLanguage, HelpDocId } from "../types";

export interface HelpDocument {
  title: string;
  markdown: string;
}

export type HelpDocumentCatalog = Record<HelpDocId, Record<GuiLanguage, HelpDocument>>;
export type HelpDocumentAppendixCatalog = Partial<Record<HelpDocId, Record<GuiLanguage, string>>>;
export type HelpDocumentSet<T extends HelpDocId> = Record<T, Record<GuiLanguage, HelpDocument>>;
export type HelpDocumentAppendixSet<T extends HelpDocId> = Partial<Record<T, Record<GuiLanguage, string>>>;

export type InstrumentHelpDocId = Extract<
  HelpDocId,
  "instrument_patch_toolbar" | "instrument_opcode_catalog" | "instrument_graph_editor" | "instrument_runtime_panel"
>;

export type SequencerHelpDocId = Extract<
  HelpDocId,
  | "sequencer_instrument_rack"
  | "sequencer_tracks"
  | "sequencer_track_editor"
  | "sequencer_multitrack_arranger"
  | "sequencer_drummer_sequencer"
  | "sequencer_controller_sequencer"
  | "sequencer_piano_rolls"
  | "sequencer_midi_controllers"
>;

export type ConfigHelpDocId = Extract<
  HelpDocId,
  "config_audio_engine" | "config_browser_clock_latency" | "config_engine_values"
>;
