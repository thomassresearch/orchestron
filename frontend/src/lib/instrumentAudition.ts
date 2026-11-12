import type { EditablePatch } from "../store/appStoreTypes";
import type { Patch, SessionInstrumentAssignment } from "../types";
import { audioPorts } from "./audioBlocks";
import { emptyAudioGraph, emptyMixer, newRoute } from "./audioRouting";
import { audioTemplate } from "./audioTemplates";

export const auditionSignature = (patch: EditablePatch) => JSON.stringify({ graph: patch.graph, always_on: patch.always_on });

/** A private snapshot: no library writes, performance bindings or MIDI mappings. */
export function isolatedAudition(draft: EditablePatch, values: Record<string, number>, mappingError: string) {
  const patch: Patch = { ...structuredClone(draft), id: crypto.randomUUID(), is_template: false,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const patches = [patch], graph = emptyAudioGraph(), midi: number[] = [];
  const instruments: SessionInstrumentAssignment[] = [{ id: "preview", patch_id: patch.id,
    midi_channel: patch.always_on ? 0 : 1, performance_controller_values: { ...values } }];
  graph.masterId = "$master";
  const mainPorts = (p: Patch, direction: "input" | "output") => {
    const info = p.graph.audio_interface;
    return info?.groups.find(g => g.id === (direction === "input" ? info.mainInput : info.mainOutput))?.ports ?? audioPorts(p.graph, direction);
  };
  const ports = mainPorts(patch, "output");
  if (ports.length !== 2) throw new Error(mappingError);
  // Direct outputs already bypass Master; routing them again would duplicate their signal.
  if (!ports.every(port => port.startsWith("$direct."))) {
    graph.routes.push(...ports.map((sourcePort, i) => newRoute({ sourceId: "preview", sourcePort,
      targetId: "$master", targetPort: i ? "right" : "left", kind: "main", sourceStage: "strip", targetStage: "input" })));
  }
  const inlets = mainPorts(patch, "input");
  if (inlets.length) {
    const source = audioTemplate("instrument");
    source.id = crypto.randomUUID(); source.created_at = patch.created_at; source.updated_at = patch.updated_at;
    const outputs = mainPorts(source, "output");
    if (outputs.length !== inlets.length) throw new Error(mappingError);
    patches.push(source);
    instruments.push({ id: "preview-source", patch_id: source.id, midi_channel: 2 });
    graph.routes.push(...outputs.map((sourcePort, i) => newRoute({ sourceId: "preview-source", sourcePort,
      targetId: "preview", targetPort: inlets[i], kind: "main", sourceStage: "strip", targetStage: "input" })));
    midi.push(2);
  }
  if (!patch.always_on) midi.push(1);
  return { midi, payload: { patches, session: { instruments, audio_graph: graph, mixer: emptyMixer() } } };
}
