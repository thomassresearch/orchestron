import { audioCopy } from "./audioCopy";
import { stereoCopy } from "./stereoCopy";
import type { AudioDirection } from "./audioBlocks";
import type { GuiLanguage, OpcodeSpec } from "../types";

export const STEREO_INPUT = "__stereo_input";
export const STEREO_OUTPUT = "__stereo_output";
export function stereoOpcodeDirection(name: string): AudioDirection | null {
  return name === STEREO_INPUT ? "input" : name === STEREO_OUTPUT ? "output" : null;
}
export function stereoOpcodeLabel(name: string, language: GuiLanguage): string {
  const direction = stereoOpcodeDirection(name);
  return direction ? audioCopy(language)(direction === "input" ? "stereoInput" : "stereoOutput") : name;
}
/** Creation commands only. Never serialize these specs as graph nodes. */
export function stereoCatalogEntries(opcodes: OpcodeSpec[], language: GuiLanguage): OpcodeSpec[] {
  const copy = stereoCopy(language);
  return (["input", "output"] as const).map((direction) => {
    const underlying = direction === "input" ? "inleta" : "outleta";
    const ports = ["left", "right"].map((id) => ({ id, name: copy(id as "left" | "right"), signal_type: "a" as const, required: true, description: copy(id as "left" | "right") }));
    return {
      name: direction === "input" ? STEREO_INPUT : STEREO_OUTPUT, category: "audio",
      description: copy(direction === "input" ? "inputHelp" : "outputHelp"),
      icon: opcodes.find((s) => s.name === underlying)?.icon ?? "/static/icons/outs.svg",
      documentation_url: `https://csound.com/docs/manual/${underlying}.html`,
      documentation_markdown: copy(direction === "input" ? "inputHelp" : "outputHelp"),
      inputs: direction === "output" ? ports : [], outputs: direction === "input" ? ports : [],
      template: "", tags: ["stereo", underlying, stereoOpcodeLabel(direction === "input" ? STEREO_INPUT : STEREO_OUTPUT, language)]
    };
  });
}
