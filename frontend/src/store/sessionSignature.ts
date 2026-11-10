import type { SessionRendererRequest } from "../types";
import type { AppStore } from "./appStoreTypes";

type RendererState = Pick<AppStore, "parallelPlaybackEnabled" | "browserClockLatencySettings" | "parallelRenderBatchFrames">;
type SessionSignatureState = RendererState & Pick<AppStore, "audioGraph" | "patches">;

export function sessionRendererRequest(state: RendererState): SessionRendererRequest | undefined {
  return state.parallelPlaybackEnabled ? {
    renderer_mode: "auto",
    browser_settings: state.browserClockLatencySettings,
    parallel_batch_frames: state.parallelRenderBatchFrames
  } : undefined;
}

// Session creation and live updates must agree on the setup owned by the session.
export function sessionAudioSignature(state: SessionSignatureState): string {
  const renderer = sessionRendererRequest(state);
  return JSON.stringify({
    graph: state.audioGraph,
    patches: state.patches.map(patch => [patch.id, patch.updated_at]),
    ...(renderer ? { renderer } : {})
  });
}
