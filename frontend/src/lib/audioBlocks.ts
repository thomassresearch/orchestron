import { readInputFormulaMap, writeInputFormulaMap, parseFormulaTargetKey, type InputFormulaMap } from "./graphFormula";
import type { AudioPortGroup, Connection, NodeInstance, OpcodeSpec, PatchGraph } from "../types";

function portName(graph: PatchGraph, node: NodeInstance): string {
  const link = graph.connections.find((c) => c.to_node_id === node.id && c.to_port_id === "sname");
  const literal = link && graph.nodes.find((n) => n.id === link.from_node_id && n.opcode === "const_s");
  return String(literal?.params.value ?? node.params.sname ?? "");
}
export function audioPorts(graph: PatchGraph, direction: "input" | "output") {
  return [...new Set(graph.nodes.filter((n) => n.opcode === (direction === "input" ? "inleta" : "outleta")).map((n) => portName(graph, n)).filter(Boolean)), ...(direction === "output" && graph.nodes.some((n) => n.opcode === "outs") ? ["$direct.left", "$direct.right"] : [])];
}
export function addStereoBlock(graph: PatchGraph, direction: "input" | "output"): PatchGraph {
  const id = crypto.randomUUID(); const existing = audioPorts(graph, direction);
  const prefix = existing.includes("left") || existing.includes("right") ? `bus${graph.audio_interface?.groups.length ?? 1}.` : "";
  const ports = [`${prefix}left`, `${prefix}right`];
  const group: AudioPortGroup = { id, name: direction === "input" ? "Stereo Input" : "Stereo Output", direction, layout: "stereo", ports, purpose: "main" };
  return { ...graph, nodes: [...graph.nodes, ...ports.map((sname, i) => ({ id: `${id}-${i}`, opcode: direction === "input" ? "inleta" : "outleta", params: { sname }, position: { x: direction === "input" ? 0 : 800, y: graph.nodes.length * 25 + i * 180 } }))],
    audio_interface: { ...graph.audio_interface, role: graph.audio_interface?.role ?? "custom", groups: [...graph.audio_interface?.groups ?? [], group], ...(direction === "input" && !graph.audio_interface?.mainInput ? { mainInput: id } : {}), ...(direction === "output" && !graph.audio_interface?.mainOutput ? { mainOutput: id } : {}) }
  };
}
/** UI-only projection. The compiler and saved patches always receive ordinary nodes. */
export function projectAudioBlocks(graph: PatchGraph, labels: { input: string; output: string }, opcodes: OpcodeSpec[]) {
  const hidden = new Map<string, { group: string; port: string }>();
  const members = new Map<string, NodeInstance[]>();
  const synthetic: NodeInstance[] = []; const specs: OpcodeSpec[] = [];
  const collapsed = (graph.ui_layout.audio_blocks ?? {}) as Record<string, boolean>;
  for (const group of graph.audio_interface?.groups ?? []) {
    if (group.layout !== "stereo" || collapsed[group.id] === false) continue;
    const nodes = group.ports.map((port) => graph.nodes.filter((n) => n.opcode === (group.direction === "input" ? "inleta" : "outleta") && portName(graph, n) === port));
    if (nodes.some((list) => list.length !== 1)) continue;
    const pair = nodes.map((list) => list[0]); const id = `__audio_block_${group.id}`;
    if (pair.some((node) => hidden.has(node.id))) continue;
    members.set(id, pair);
    pair.forEach((n, i) => hidden.set(n.id, { group: id, port: i ? "right" : "left" }));
    const opcode = `${labels[group.direction]} · ${group.name} (${group.ports.join(" / ")})`;
    synthetic.push({ id, opcode, params: {}, position: pair[0].position });
    const ports = ["left", "right"].map((id, i) => ({ id, name: group.ports[i], signal_type: "a" as const, required: true, description: group.ports[i] }));
    specs.push({ name: opcode, category: "audio", description: group.ports.join(" / "), inputs: group.direction === "output" ? ports : [], outputs: group.direction === "input" ? ports : [], icon: opcodes.find((s) => s.name === "inleta")?.icon ?? "", documentation_markdown: "", documentation_url: "", template: "", tags: [] });
  }
  const visible = (c: Connection) => !(hidden.has(c.to_node_id) && c.to_port_id === "sname");
  const projectConnection = (c: Connection): Connection => {
    const source = hidden.get(c.from_node_id); const target = hidden.get(c.to_node_id);
    return { from_node_id: source?.group ?? c.from_node_id, from_port_id: source?.port ?? c.from_port_id, to_node_id: target?.group ?? c.to_node_id, to_port_id: target?.port ?? c.to_port_id };
  };
  const restoreConnection = (c: Connection): Connection => {
    const source = members.get(c.from_node_id); const target = members.get(c.to_node_id);
    return { from_node_id: source?.[c.from_port_id === "right" ? 1 : 0].id ?? c.from_node_id, from_port_id: source ? "asignal" : c.from_port_id, to_node_id: target?.[c.to_port_id === "right" ? 1 : 0].id ?? c.to_node_id, to_port_id: target ? "asignal" : c.to_port_id };
  };
  const mapFormulas = (layout: PatchGraph["ui_layout"], map: (connection: Connection) => Connection) => {
    const result: InputFormulaMap = {};
    for (const [key, formula] of Object.entries(readInputFormulaMap(layout))) {
      const target = parseFormulaTargetKey(key)!;
      const mapped = map({ from_node_id: "", from_port_id: "", to_node_id: target.toNodeId, to_port_id: target.toPortId });
      result[`${mapped.to_node_id}::${mapped.to_port_id}`] = { ...formula, inputs: formula.inputs.map((binding) => {
        const source = map({ ...binding, to_node_id: "", to_port_id: "" });
        return { ...binding, from_node_id: source.from_node_id, from_port_id: source.from_port_id };
      }) };
    }
    return writeInputFormulaMap(layout, result);
  };
  const display = { ...graph, ui_layout: mapFormulas(graph.ui_layout, projectConnection), nodes: [...graph.nodes.filter((n) => !hidden.has(n.id)), ...synthetic], connections: graph.connections.filter(visible).map(projectConnection) };
  return { graph: display, opcodes: [...opcodes, ...specs], members, restoreConnection,
    restore(next: PatchGraph): PatchGraph {
      const nodes = next.nodes.flatMap((n) => {
        const pair = members.get(n.id); if (!pair) return [n];
        return pair.map((original) => ({ ...original, position: { x: original.position.x + n.position.x - pair[0].position.x, y: original.position.y + n.position.y - pair[0].position.y } }));
      });
      const layout = mapFormulas(next.ui_layout, restoreConnection);
      return { ...next, nodes, ui_layout: layout, connections: [...graph.connections.filter((c) => !visible(c) && nodes.some((n) => n.id === c.to_node_id)), ...next.connections.map(restoreConnection)] };
    }
  };
}
