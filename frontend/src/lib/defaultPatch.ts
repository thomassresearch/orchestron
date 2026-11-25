import type { PatchGraph } from "../types";

export function withoutPatchEngine(graph: PatchGraph): PatchGraph {
  if (!("engine_config" in graph)) return graph;
  const result = { ...graph };
  delete result.engine_config;
  return result;
}

export function defaultGraph(): PatchGraph {
  return {
    nodes: [],
    connections: [],
    ui_layout: {}
  };
}

export function createUntitledPatch() {
  return {
    name: "Untitled Instrument",
    description: "",
    is_template: false,
    always_on: false,
    instrument_type: "melody" as const,
    schema_version: 1,
    graph: defaultGraph()
  };
}
