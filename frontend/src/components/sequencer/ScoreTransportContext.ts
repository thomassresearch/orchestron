import { createContext } from "react";

// Shared with App without importing the deferred score editor and its UI dependencies.
export const ScoreTransportContext = createContext<{
  play: (id: string, playing: boolean) => Promise<void>;
  queue: (id: string, pad: number | null) => Promise<void>;
} | null>(null);
