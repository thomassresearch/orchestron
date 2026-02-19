import type { PatchGraph } from "../types";

export function defaultGraph(): PatchGraph {
  return {
    nodes: [],
    connections: [],
    ui_layout: {},
    engine_config: {
      sr: 44100,
      control_rate: 1378,
      ksmps: 32,
      nchnls: 2,
      software_buffer: 128,
      hardware_buffer: 512,
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
