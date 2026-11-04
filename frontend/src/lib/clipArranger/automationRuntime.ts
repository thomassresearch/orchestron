import type { SequencerState, SessionSequencerConfigRequest } from "../../types";
let builder: ((state: SequencerState) => SessionSequencerConfigRequest) | undefined;
export function registerAutomationRuntime(value: typeof builder) { builder = value; }
export function automationRuntimeConfig(state: SequencerState) {
  if (!builder) throw new Error("The performance runtime is not ready.");
  return builder(state);
}
