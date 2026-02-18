import type { PatchGraph } from "../types";

export function defaultGraph(): PatchGraph {
  return {
    nodes: [],
    connections: [],
    ui_layout: {},
    engine_config: {
      sr: 44100,
      control_rate: 4400,
      ksmps: 10,
      nchnls: 2,
      "0dbfs": 1
    }
  };
}

export function createUntitledPatch() {
  return {
    name: "Untitled Instrument",
    description: "",
    schema_version: 1,
    graph: defaultGraph()
  };
}
