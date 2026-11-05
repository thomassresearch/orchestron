import { createContext } from "react";
import type { ScorePadState } from "../../types";

export type ScoreKeyboardNote = Pick<ScorePadState, "scaleRoot" | "scaleType" | "mode"> & {
  trackId: string;
  pitch: number;
  midiChannel: number;
};
export type PreviewScoreNote = (note: ScoreKeyboardNote, onRelease: () => void) => () => void;

// Shared with App without importing the deferred score editor and its UI dependencies.
export const ScoreTransportContext = createContext<{
  play: (id: string, playing: boolean) => Promise<void>;
  queue: (id: string, pad: number | null) => Promise<void>;
  previewNote: PreviewScoreNote;
} | null>(null);
