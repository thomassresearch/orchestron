import { defaultGraph } from "./defaultPatch";
import type { Patch, NodeInstance, Connection, AudioPortGroup } from "../types";
import drumset from "../../../examples/analog_drumkit.patch.json";

export type BuiltinTemplate = "instrument" | "effect" | "output" | "empty" | "drumset";
export function audioTemplate(kind: BuiltinTemplate): Patch {
  if (kind === "drumset") return structuredClone(drumset) as unknown as Patch;
  const graph = defaultGraph();
  const node = (id: string, opcode: string, params: NodeInstance["params"], x: number, y: number) => graph.nodes.push({ id, opcode, params, position: { x, y } });
  const wire = (from: string, fromPort: string, to: string, toPort: string) => graph.connections.push({ from_node_id: from, from_port_id: fromPort, to_node_id: to, to_port_id: toPort } as Connection);
  const groups: AudioPortGroup[] = [];
  if (kind !== "empty") {
    if (kind === "instrument") {
      node("pitch", "cpsmidi", {}, 0, 0);
      node("velocity", "ampmidi", { iscal: 0.12 }, 0, 180);
      node("envelope", "madsr", { iatt: 0.01, idec: 0.15, islev: 0.7, irel: 0.2, idel: 0, ireltim: -1 }, 0, 360);
      node("amplitude", "k_mul", {}, 260, 180);
      node("oscillator", "oscili", { ifn: -1 }, 500, 0);
      wire("pitch", "kfreq", "oscillator", "freq");
      wire("velocity", "iamp", "amplitude", "a");
      wire("envelope", "kenv", "amplitude", "b");
      wire("amplitude", "kout", "oscillator", "amp");
    } else {
      node("input-left", "inleta", { sname: "left" }, 0, 0);
      node("input-right", "inleta", { sname: "right" }, 0, 180);
      groups.push({ id: "main-input", name: "Stereo Input", direction: "input", layout: "stereo", ports: ["left", "right"], purpose: "main" });
    }
    if (kind === "output") node("output", "outs", {}, 500, 0);
    else {
      node("output-left", "outleta", { sname: "left" }, 760, 0);
      node("output-right", "outleta", { sname: "right" }, 760, 180);
    }
    for (const side of ["left", "right"]) {
      wire(kind === "instrument" ? "oscillator" : `input-${side}`, kind === "instrument" ? "asig" : "asignal",
        kind === "output" ? "output" : `output-${side}`, kind === "output" ? side : "asignal");
    }
    groups.push({ id: "main-output", name: kind === "output" ? "Direct Audio Output" : "Stereo Output", direction: "output", layout: "stereo", ports: kind === "output" ? ["$direct.left", "$direct.right"] : ["left", "right"], purpose: "main" });
    graph.audio_interface = { role: kind, groups, mainInput: kind === "instrument" ? null : "main-input", mainOutput: "main-output", guided: true };
  }
  const names = { instrument: "Playable instrument", effect: "Audio effect", output: "Master", empty: "Empty patch" };
  return { id: `builtin-${kind}`, name: names[kind], description: "", is_template: false, always_on: kind === "effect" || kind === "output", schema_version: 1, graph, created_at: "", updated_at: "" };
}
