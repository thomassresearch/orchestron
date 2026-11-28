import type { EditablePatch } from "../store/appStoreTypes";
import type { EngineConfig } from "../types";

// Library revisions include node positions. A compilation depends on the sound and engine settings.
export function patchSignature(patch: EditablePatch, engine?: EngineConfig): string {
  const { graph, name, description, is_template, instrument_type, always_on, schema_version } = patch;
  const layout = { ...graph.ui_layout };
  delete layout.editor_state;
  const content = {
    name, description, is_template, instrument_type, always_on, schema_version, engine,
    nodes: engine ? graph.nodes.map(({ id, opcode, params }) => ({ id, opcode, params })) : graph.nodes,
    connections: graph.connections,
    ui_layout: layout,
    audio_interface: graph.audio_interface ?? null,
    control_flow: graph.control_flow ?? {}
  };
  // API serialization can reorder object keys without changing the patch.
  return JSON.stringify(content, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}
