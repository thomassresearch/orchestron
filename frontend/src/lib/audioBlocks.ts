import { readInputFormulaMap, writeInputFormulaMap, parseFormulaTargetKey, type InputFormulaMap } from "./graphFormula";
import type { AudioPortGroup, Connection, NodeInstance, NodePosition, OpcodeSpec, PatchGraph } from "../types";
import { expandControlFlowDeletion, reconcileControlFlow } from "./controlFlow";

export type AudioDirection = "input" | "output";
export type StereoCommand =
  | { kind: "create"; direction: AudioDirection; position?: NodePosition }
  | { kind: "group"; direction: AudioDirection; nodeIds: [string, string]; groupId?: string }
  | { kind: "convert"; nodeId: string }
  | { kind: "repair"; groupId: string };
export type AudioBlockIssue = "missingMembers" | "ambiguousMembers" | "overlappingMembers" | "dynamicMembers" | "invalidNames";
export class AudioBlockError extends Error {
  constructor(public readonly code: AudioBlockIssue) { super(code); }
}
const opcodeFor = (direction: AudioDirection) => direction === "input" ? "inleta" : "outleta";

/** Never infer a literal from a parameter when a connected expression overrides it. */
export function audioPortName(graph: PatchGraph, node: NodeInstance): string | null {
  const formulas = readInputFormulaMap(graph.ui_layout);
  if (formulas[`${node.id}::sname`]) return null;
  const links = graph.connections.filter((c) => c.to_node_id === node.id && c.to_port_id === "sname");
  if (!links.length) return typeof node.params.sname === "string" ? node.params.sname : null;
  if (links.length !== 1 || links[0].from_port_id !== "sout") return null;
  const literal = graph.nodes.find((n) => n.id === links[0].from_node_id && n.opcode === "const_s");
  if (literal && formulas[`${literal.id}::value`]) return null;
  return typeof literal?.params.value === "string" ? literal.params.value : null;
}
export function audioPorts(graph: PatchGraph, direction: AudioDirection): string[] {
  const namedPorts = graph.nodes
    .filter((node) => node.opcode === opcodeFor(direction))
    .map((node) => audioPortName(graph, node))
    .filter((name): name is string => !!name);
  const directPorts = direction === "output" && graph.nodes.some((node) => node.opcode === "outs")
    ? ["$direct.left", "$direct.right"] : [];
  return [...new Set(namedPorts), ...directPorts];
}

export function resolveStereoMembers(graph: PatchGraph, group: AudioPortGroup): { nodes: NodeInstance[]; issue?: AudioBlockIssue } {
  if (group.layout !== "stereo" || group.ports.length !== 2 || group.ports.some((p) => !p.trim()) || new Set(group.ports).size !== 2) return { nodes: [], issue: "invalidNames" };
  const candidates = graph.nodes.filter((n) => n.opcode === opcodeFor(group.direction));
  const matches = group.ports.map((port) => candidates.filter((n) => audioPortName(graph, n) === port));
  if (matches.some((m) => m.length > 1)) return { nodes: [], issue: "ambiguousMembers" };
  if (matches.some((m) => !m.length)) return { nodes: [], issue: candidates.some((n) => audioPortName(graph, n) === null) ? "dynamicMembers" : "missingMembers" };
  if (graph.audio_interface?.groups.some((other) => other.id !== group.id && other.direction === group.direction && other.ports.some((p) => group.ports.includes(p)))) return { nodes: [], issue: "overlappingMembers" };
  return { nodes: matches.map((m) => m[0]) };
}

/** Store grouped channel names on the channels, independently of legacy naming nodes. */
export function normalizeStereoChannelNames(graph: PatchGraph): PatchGraph {
  const names = new Map<string, string>();
  for (const group of graph.audio_interface?.groups ?? []) {
    const resolution = resolveStereoMembers(graph, group);
    if (!resolution.issue) resolution.nodes.forEach((node, i) => names.set(node.id, group.ports[i]));
  }
  if (!names.size) return graph;
  const nameConnections = graph.connections.filter((c) => names.has(c.to_node_id) && c.to_port_id === "sname");
  if (!nameConnections.length) return graph;

  const detached = new Set(nameConnections);
  const connections = graph.connections.filter((c) => !detached.has(c));
  const candidates = new Set(nameConnections.map((c) => c.from_node_id));
  const channels = new Set(nameConnections.map((c) => c.to_node_id));
  // Shared constants may still drive other ports or be referenced only by a formula.
  const referenced = new Set(connections.flatMap((c) => [c.from_node_id, c.to_node_id]));
  for (const [key, formula] of Object.entries(readInputFormulaMap(graph.ui_layout))) {
    referenced.add(parseFormulaTargetKey(key)!.toNodeId);
    formula.inputs.forEach((input) => referenced.add(input.from_node_id));
  }
  return {
    ...graph,
    nodes: graph.nodes
      .filter((node) => !candidates.has(node.id) || referenced.has(node.id))
      .map((node) => channels.has(node.id) ? { ...node, params: { ...node.params, sname: names.get(node.id)! } } : node),
    connections
  };
}

function availableStereoPorts(graph: PatchGraph, direction: AudioDirection): [string, string] {
  const used = new Set([...audioPorts(graph, direction), ...(graph.audio_interface?.groups.filter((g) => g.direction === direction).flatMap((g) => g.ports) ?? [])]);
  let index = 0;
  while (true) {
    const prefix = index ? `bus${index}.` : "";
    const ports: [string, string] = [`${prefix}left`, `${prefix}right`];
    if (ports.every((port) => !used.has(port))) return ports;
    index++;
  }
}
function withGroup(graph: PatchGraph, group: AudioPortGroup): PatchGraph {
  const info = graph.audio_interface;
  const main = group.direction === "input" ? "mainInput" : "mainOutput";
  return normalizeStereoChannelNames({
    ...graph,
    audio_interface: {
      ...info,
      role: info?.role ?? "custom",
      groups: [...(info?.groups.filter((g) => g.id !== group.id) ?? []), group],
      [main]: info?.[main] ?? group.id
    },
    ui_layout: {
      ...graph.ui_layout,
      audio_blocks: { ...(graph.ui_layout.audio_blocks as Record<string, boolean> ?? {}), [group.id]: true }
    }
  });
}

export function addStereoBlock(graph: PatchGraph, direction: AudioDirection, position?: NodePosition): PatchGraph {
  const id = crypto.randomUUID();
  const ports = availableStereoPorts(graph, direction);
  const origin = position ?? { x: direction === "input" ? 0 : 800, y: graph.nodes.length * 25 };
  const nodes = ports.map((sname, i) => ({
    id: crypto.randomUUID(),
    opcode: opcodeFor(direction),
    params: { sname },
    position: { x: origin.x, y: origin.y + i * 180 }
  }));
  return withGroup({ ...graph, nodes: [...graph.nodes, ...nodes] }, {
    id,
    name: direction === "input" ? "Stereo Input" : "Stereo Output",
    direction,
    layout: "stereo",
    ports,
    purpose: "main"
  });
}

export function removeAudioGroups(graph: PatchGraph, groupIds: string[]): PatchGraph {
  if (!groupIds.length || !graph.audio_interface) return graph;
  const removed = new Set(groupIds);
  const blocks = { ...(graph.ui_layout.audio_blocks as Record<string, boolean> ?? {}) };
  groupIds.forEach((id) => delete blocks[id]);
  return {
    ...graph,
    audio_interface: {
      ...graph.audio_interface,
      groups: graph.audio_interface.groups.filter((g) => !removed.has(g.id)),
      mainInput: removed.has(graph.audio_interface.mainInput ?? "") ? null : graph.audio_interface.mainInput,
      mainOutput: removed.has(graph.audio_interface.mainOutput ?? "") ? null : graph.audio_interface.mainOutput
    },
    ui_layout: { ...graph.ui_layout, audio_blocks: blocks }
  };
}

/** Reconcile deliberate node removals only. Loading a legacy patch never erases metadata. */
export function reconcileAudioGraph(before: PatchGraph, next: PatchGraph): PatchGraph {
  next = reconcileControlFlow(before, next);
  const removed = new Set(before.nodes.filter((n) => !next.nodes.some((m) => m.id === n.id)).map((n) => n.id));
  if (!removed.size) return next;
  const groups = (before.audio_interface?.groups ?? []).filter((g) => {
    if (g.layout !== "stereo") return false;
    const replacement = next.audio_interface?.groups.find((other) => other.id === g.id);
    if (replacement && JSON.stringify(replacement.ports) !== JSON.stringify(g.ports) && !resolveStereoMembers(next, replacement).issue) return false;
    if (g.ports.every((p) => p.startsWith("$direct."))) return before.nodes.some((n) => n.opcode === "outs") && !next.nodes.some((n) => n.opcode === "outs");
    return resolveStereoMembers(before, g).nodes.some((n) => removed.has(n.id));
  }).map((g) => g.id);
  const formulas = Object.fromEntries(Object.entries(readInputFormulaMap(next.ui_layout)).filter(([key, value]) =>
    !removed.has(parseFormulaTargetKey(key)!.toNodeId) &&
    !value.inputs.some((input) => removed.has(input.from_node_id))
  ));
  return removeAudioGroups({
    ...next,
    connections: next.connections.filter((c) => !removed.has(c.from_node_id) && !removed.has(c.to_node_id)),
    ui_layout: writeInputFormulaMap(next.ui_layout, formulas)
  }, groups);
}

export function deleteAudioGraphItems(graph: PatchGraph, nodeIds: string[], connections: Connection[] = [], groupIds: string[] = []): PatchGraph {
  const removed = new Set(expandControlFlowDeletion(graph, nodeIds));
  const key = (c: Connection) => JSON.stringify([c.from_node_id, c.from_port_id, c.to_node_id, c.to_port_id]);
  const wires = new Set(connections.map(key));
  const next = reconcileAudioGraph(graph, {
    ...graph,
    nodes: graph.nodes.filter((n) => !removed.has(n.id)),
    connections: graph.connections.filter((c) => !wires.has(key(c)))
  });
  return removeAudioGroups(next, groupIds);
}
function requireGroup(graph: PatchGraph, id: string): AudioPortGroup {
  const group = graph.audio_interface?.groups.find((g) => g.id === id);
  if (!group) throw new AudioBlockError("missingMembers");
  return group;
}
export function renameStereoBlock(graph: PatchGraph, groupId: string, names: [string, string]): PatchGraph {
  graph = normalizeStereoChannelNames(graph);
  const group = requireGroup(graph, groupId);
  const members = resolveStereoMembers(graph, group);
  if (members.issue) throw new AudioBlockError(members.issue);
  const ports = names.map((name) => name.trim());
  const ids = new Set(members.nodes.map((n) => n.id));
  const used = new Set([...audioPorts({ ...graph, nodes: graph.nodes.filter((n) => !ids.has(n.id)) }, group.direction), ...(graph.audio_interface?.groups.filter((g) => g.id !== groupId && g.direction === group.direction).flatMap((g) => g.ports) ?? [])]);
  if (ports.some((p) => !p || p.startsWith("$direct.") || used.has(p)) || ports[0] === ports[1]) throw new AudioBlockError("invalidNames");
  const renamedIds = new Set(members.nodes.filter((_, i) => ports[i] !== group.ports[i]).map((n) => n.id));
  return {
    ...graph,
    nodes: graph.nodes.map((node) => renamedIds.has(node.id) ? {
      ...node,
      params: { ...node.params, sname: ports[members.nodes.findIndex((member) => member.id === node.id)] }
    } : node),
    connections: graph.connections.filter((c) => !(renamedIds.has(c.to_node_id) && c.to_port_id === "sname")),
    audio_interface: {
      ...graph.audio_interface!,
      groups: graph.audio_interface!.groups.map((g) => g.id === groupId ? { ...g, ports } : g)
    }
  };
}
export function groupStereoNodes(graph: PatchGraph, direction: AudioDirection, nodeIds: [string, string], groupId?: string): PatchGraph {
  const nodes = nodeIds.map((id) => graph.nodes.find((n) => n.id === id && n.opcode === opcodeFor(direction)));
  if (nodeIds[0] === nodeIds[1] || nodes.some((n) => !n)) throw new AudioBlockError("invalidNames");
  const ports = nodes.map((n) => audioPortName(graph, n!));
  if (ports.some((p) => !p)) throw new AudioBlockError("dynamicMembers");
  const existing = groupId ? requireGroup(graph, groupId) : undefined;
  if (existing && existing.direction !== direction) throw new AudioBlockError("invalidNames");
  const group: AudioPortGroup = { ...existing, id: groupId ?? crypto.randomUUID(), name: existing?.name ?? (direction === "input" ? "Stereo Input" : "Stereo Output"), direction, layout: "stereo", ports: ports as string[], purpose: existing?.purpose ?? "main" };
  const resolution = resolveStereoMembers(graph, group);
  if (resolution.issue) throw new AudioBlockError(resolution.issue);
  return withGroup(graph, group);
}
export function repairStereoBlock(graph: PatchGraph, groupId: string): PatchGraph {
  const group = requireGroup(graph, groupId);
  if (group.layout !== "stereo" || group.ports.length !== 2 || group.ports.some((p) => !p.trim() || p.startsWith("$direct.")) || new Set(group.ports).size !== 2) throw new AudioBlockError("invalidNames");
  const issue = resolveStereoMembers(graph, group).issue;
  if (issue && issue !== "missingMembers") throw new AudioBlockError(issue);
  const nodes = [...graph.nodes];
  group.ports.forEach((sname, i) => {
    if (!nodes.some((n) => n.opcode === opcodeFor(group.direction) && audioPortName(graph, n) === sname)) nodes.push({ id: crypto.randomUUID(), opcode: opcodeFor(group.direction), params: { sname }, position: { x: group.direction === "input" ? 0 : 800, y: graph.nodes.length * 25 + i * 180 } });
  });
  const next = { ...graph, nodes };
  const result = resolveStereoMembers(next, group);
  if (result.issue) throw new AudioBlockError(result.issue);
  return withGroup(next, group);
}
export function convertDirectOutput(graph: PatchGraph, nodeId: string): PatchGraph {
  const node = graph.nodes.find((n) => n.id === nodeId && n.opcode === "outs");
  if (!node) throw new AudioBlockError("missingMembers");
  let next = addStereoBlock(graph, "output", node.position);
  const group = next.audio_interface!.groups[next.audio_interface!.groups.length - 1];
  const pair = resolveStereoMembers(next, group).nodes;
  const formulas = readInputFormulaMap(next.ui_layout);
  const connections = graph.connections.map((c) => c.to_node_id === nodeId && ["left", "right"].includes(c.to_port_id) ? { ...c, to_node_id: pair[c.to_port_id === "left" ? 0 : 1].id, to_port_id: "asignal" } : c);
  pair.forEach((member, i) => {
    const side = i ? "right" : "left";
    if (node.params[side] !== undefined) member.params = { ...member.params, asignal: node.params[side] };
    const formula = formulas[`${nodeId}::${side}`];
    if (formula) { formulas[`${member.id}::asignal`] = formula; delete formulas[`${nodeId}::${side}`]; }
  });
  next = { ...next, connections, nodes: next.nodes.filter((n) => n.id !== nodeId), ui_layout: writeInputFormulaMap(next.ui_layout, formulas) };
  if (graph.nodes.filter((n) => n.opcode === "outs").length === 1) {
    const direct = graph.audio_interface?.groups.filter((g) => g.direction === "output" && g.layout === "stereo" && g.ports.length === 2 && g.ports[0] === "$direct.left" && g.ports[1] === "$direct.right") ?? [];
    if (direct.length === 1) {
      const replacement = { ...direct[0], name: direct[0].name === "Direct Audio Output" ? "Stereo Output" : direct[0].name, ports: group.ports };
      next = removeAudioGroups(next, [group.id]);
      next = withGroup(next, replacement);
      next.audio_interface = { ...next.audio_interface!, mainOutput: graph.audio_interface?.mainOutput ?? replacement.id };
    }
  }
  return next;
}
export function executeStereoCommand(graph: PatchGraph, command: StereoCommand): PatchGraph {
  switch (command.kind) {
    case "create": return addStereoBlock(graph, command.direction, command.position);
    case "group": return groupStereoNodes(graph, command.direction, command.nodeIds, command.groupId);
    case "convert": return convertDirectOutput(graph, command.nodeId);
    case "repair": return repairStereoBlock(graph, command.groupId);
  }
}
/** UI-only projection. The compiler and saved patches always receive ordinary nodes. */
export function projectAudioBlocks(graph: PatchGraph, labels: { input: string; output: string }, opcodes: OpcodeSpec[]) {
  const hidden = new Map<string, { group: string; port: string }>();
  const members = new Map<string, NodeInstance[]>();
  const synthetic: NodeInstance[] = []; const specs: OpcodeSpec[] = [];
  const collapsed = (graph.ui_layout.audio_blocks ?? {}) as Record<string, boolean>;
  for (const group of graph.audio_interface?.groups ?? []) {
    if (group.layout !== "stereo" || collapsed[group.id] === false) continue;
    const resolution = resolveStereoMembers(graph, group);
    if (resolution.issue) continue;
    const pair = resolution.nodes; const id = `__audio_block_${group.id}`;
    if (pair.some((node) => hidden.has(node.id))) continue;
    members.set(id, pair);
    pair.forEach((n, i) => hidden.set(n.id, { group: id, port: i ? "right" : "left" }));
    const opcode = `${labels[group.direction]} · ${group.name} (${group.ports.join(" / ")})`;
    synthetic.push({ id, opcode, params: {}, position: pair[0].position });
    const ports = ["left", "right"].map((id, i) => ({ id, name: group.ports[i], signal_type: "a" as const, required: true, description: group.ports[i] }));
    specs.push({ name: opcode, category: "audio", description: group.ports.join(" / "), inputs: group.direction === "output" ? ports : [], outputs: group.direction === "input" ? ports : [], icon: opcodes.find((s) => s.name === opcodeFor(group.direction))?.icon ?? "", documentation_markdown: group.name, documentation_url: `https://csound.com/docs/manual/${opcodeFor(group.direction)}.html`, template: "", tags: [] });
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
  return { graph: display, opcodes: [...opcodes, ...specs], members, projectConnection, restoreConnection,
    restore(next: PatchGraph): PatchGraph {
      const nodes = next.nodes.flatMap((n) => {
        const pair = members.get(n.id); if (!pair) return [n];
        return pair.map((original) => ({ ...original, position: { x: original.position.x + n.position.x - pair[0].position.x, y: original.position.y + n.position.y - pair[0].position.y } }));
      });
      const layout = mapFormulas(next.ui_layout, restoreConnection);
      return reconcileAudioGraph(graph, { ...next, nodes, ui_layout: layout, connections: [...graph.connections.filter((c) => !visible(c) && nodes.some((n) => n.id === c.to_node_id)), ...next.connections.map(restoreConnection)] });
    }
  };
}
