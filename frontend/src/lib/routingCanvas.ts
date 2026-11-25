import { MASTER, masterEndpoint, outputPorts, suggestedInterface } from "./audioRouting";
import type { AudioGraph, AudioRoute, MixerState, PatchListItem, SequencerInstrumentBinding } from "../types";

export const OUTPUT = "$output";
export const cardWidth = 204;
export const rowHeight = 28;
export const firstSocketY = 83;
export type Point = { x: number; y: number };
export type Socket = {
  node: string; side: "in" | "out"; stage: "input" | "strip" | "raw"; ports: string[]; label: string; missing: boolean;
};
export type RoutingNode = Point & {
  id: string; patch?: PatchListItem; binding?: SequencerInstrumentBinding; number: number;
  inputs: Socket[]; outputs: Socket[]; height: number;
};
export type Cable = { key: string; source: Socket; target: Socket; routes: AudioRoute[]; implicit: boolean; lane: number };

export function routingCanvas(bindings: SequencerInstrumentBinding[], patches: PatchListItem[], graph: AudioGraph, sends: MixerState["sends"], exact: boolean, customStages: boolean) {
  const library = new Map(patches.map(p => [p.id, p]));
  const nodes = new Map<string, RoutingNode>();
  function addNode(id: string, patch?: PatchListItem, binding?: SequencerInstrumentBinding, number = 0) {
    if (!nodes.has(id)) nodes.set(id, { id, patch, binding, number, inputs: [], outputs: [], x: 0, y: 0, height: 0 });
  }
  bindings.forEach((b, i) => addNode(b.id, library.get(b.patchId), b, i + 1));
  addNode(MASTER, masterEndpoint);
  addNode(OUTPUT);
  if (graph.masterId) addNode(graph.masterId);
  for (const [child, owner] of Object.entries(graph.insertOwners)) { addNode(child); addNode(owner); }
  const insertOwners = new Set(Object.values(graph.insertOwners));
  const stages = new Set<string>();
  const portKey = (id: string, side: string, stage: string, port = "") => JSON.stringify([id, side, stage, port]);
  const redirects = new Set<string>();
  for (const r of graph.routes) {
    addNode(r.sourceId); addNode(r.targetId);
    stages.add(portKey(r.sourceId, "out", r.sourceStage));
    stages.add(portKey(r.targetId, "in", r.targetStage));
    if (r.kind === "main") redirects.add(portKey(r.sourceId, "out", "strip", r.sourcePort));
  }

  const sockets = new Map<string, Socket>();
  function socket(node: RoutingNode, side: Socket["side"], stage: Socket["stage"], ports: string[], label: string, missing = false) {
    const s = { node: node.id, side, stage, ports, label, missing };
    (side === "in" ? node.inputs : node.outputs).push(s);
    for (const port of ports) sockets.set(portKey(node.id, side, stage, port), s);
    return s;
  }
  for (const node of nodes.values()) {
    const info = node.patch?.audio_interface ?? (node.patch && suggestedInterface(node.patch));
    function addStage(side: Socket["side"], stage: Socket["stage"]) {
      const input = stage === "input";
      const ports = node.id === OUTPUT ? ["left", "right"] : input ? node.patch?.audio_inlet_names ?? [] : outputPorts(node.patch);
      const groups = node.id === OUTPUT ? [{ direction: "input", ports, name: "Stereo" }] : info?.groups ?? [];
      if (!exact) for (const group of groups) {
        if (group.direction !== (input ? "input" : "output") || group.ports.length < 2) continue;
        if (group.ports.every(p => ports.includes(p) && !sockets.has(portKey(node.id, side, stage, p)))) {
          socket(node, side, stage, group.ports, group.name);
        }
      }
      for (const p of ports) if (!sockets.has(portKey(node.id, side, stage, p))) socket(node, side, stage, [p], p);
    }
    addStage("in", "input");
    if (node.id !== OUTPUT) addStage("out", "strip");
    if (node.id !== OUTPUT) {
      const showInserts = customStages || insertOwners.has(node.id);
      if (showInserts || stages.has(portKey(node.id, "out", "raw"))) addStage("out", "raw");
      if (showInserts || stages.has(portKey(node.id, "in", "strip"))) addStage("in", "strip");
    }
  }
  const cables = new Map<string, Cable>();
  const occurrences = new Map<string, number>();
  const lanes = new Map<string, number>();
  function addCable(route: AudioRoute, implicit: boolean) {
    const resolve = (id: string, side: Socket["side"], stage: Socket["stage"], port: string) =>
      sockets.get(portKey(id, side, stage, port)) ?? socket(nodes.get(id)!, side, stage, [port], port, true);
    const source = resolve(route.sourceId, "out", route.sourceStage, route.sourcePort);
    const target = resolve(route.targetId, "in", route.targetStage, route.targetPort);
    const send = sends[route.id];
    const endpoints = [source.node, source.stage, source.ports, target.node, target.stage, target.ports];
    // Pair ordered channels once. Duplicate parallel sends and crossed or partial mappings remain inspectable.
    const offset = source.ports.length === target.ports.length ?
      (target.ports.indexOf(route.targetPort) - source.ports.indexOf(route.sourcePort) + source.ports.length) % source.ports.length :
      [route.sourcePort, route.targetPort];
    const group = [...endpoints, route.kind, implicit, send?.gainDb, send?.tap ?? "post", offset];
    const channel = JSON.stringify([...group, route.sourcePort, route.targetPort]);
    const occurrence = occurrences.get(channel) ?? 0;
    occurrences.set(channel, occurrence + 1);
    const key = JSON.stringify([...group, occurrence]);
    let cable = cables.get(key);
    if (!cable) {
      const path = JSON.stringify(endpoints);
      const index = lanes.get(path) ?? 0;
      lanes.set(path, index + 1);
      const lane = Math.min(6, Math.ceil(index / 2)) * (index % 2 ? 1 : -1);
      cable = { key, source, target, routes: [], implicit, lane };
      cables.set(key, cable);
    }
    cable.routes.push(route);
  }
  for (const route of graph.routes) addCable(route, false);
  for (const node of nodes.values()) {
    if (!node.patch?.has_direct_output || (node.id === MASTER && graph.masterId !== MASTER)) continue;
    for (const side of ["left", "right"]) {
      const port = "$direct." + side;
      if (!redirects.has(portKey(node.id, "out", "strip", port))) {
        addCable({ id: "", sourceId: node.id, sourcePort: port, sourceStage: "strip", targetId: OUTPUT, targetPort: side, targetStage: "input", kind: "main" }, true);
      }
    }
  }
  const columns: RoutingNode[][] = [[], [], [], []];
  for (const node of nodes.values()) {
    const column = node.id === OUTPUT ? 3 : node.id === MASTER ? 2 : node.inputs.some(s => s.stage === "input") ? 1 : 0;
    node.height = firstSocketY + 20 + (Math.max(1, node.inputs.length, node.outputs.length) - 1) * rowHeight;
    columns[column].push(node);
  }
  columns.filter(col => col.length).forEach((column, i) => {
    let top = column === columns[1] && columns[0].length ? 170 : 24;
    for (const node of column) {
      node.x = 24 + i * (cardWidth + 86);
      node.y = top;
      top += node.height + 46;
    }
  });
  return { nodes, cables: [...cables.values()] };
}

export function socketPoint(node: RoutingNode, socket: Socket, position: Point = node): Point {
  const output = socket.side === "out";
  const index = (output ? node.outputs : node.inputs).indexOf(socket);
  return { x: position.x + (output ? cardWidth : 0), y: position.y + firstSocketY + index * rowHeight };
}

export function cablePath(a: Point, b: Point, lane = 0, cards: (Point & { height: number })[] = []) {
  const bend = Math.max(35, Math.min(120, Math.abs(b.x - a.x) / 2));
  if (b.x <= a.x) {
    const below = Math.max(a.y, b.y) + 64 + lane * 10;
    return `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${a.x + bend} ${below}, ${a.x} ${below} L ${b.x} ${below} C ${b.x - bend} ${below}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`;
  }
  // A dry route can cross an entire return column. Keep it clear of those cards and their sockets.
  if (b.x - a.x > cardWidth) {
    const between = cards.filter(n => n.x > a.x + 12 && n.x + cardWidth < b.x - 12);
    if (between.some(n => n.y < Math.max(a.y, b.y) + 10 && n.y + n.height > Math.min(a.y, b.y) - 10)) {
      const above = Math.min(...between.map(n => n.y)) - 20 - Math.abs(lane) * 5;
      const below = Math.max(...between.map(n => n.y + n.height)) + 20 + Math.abs(lane) * 5;
      const y = Math.abs(a.y - above) + Math.abs(b.y - above) <= Math.abs(a.y - below) + Math.abs(b.y - below) ? above : below;
      const left = Math.min(...between.map(n => n.x)) - 12;
      const right = Math.max(...between.map(n => n.x + cardWidth)) + 12;
      const x1 = (a.x + left) / 2, x2 = (right + b.x) / 2;
      return `M ${a.x} ${a.y} C ${x1} ${a.y}, ${x1} ${y}, ${left} ${y} L ${right} ${y} C ${x2} ${y}, ${x2} ${b.y}, ${b.x} ${b.y}`;
    }
  }
  return `M ${a.x} ${a.y} C ${a.x + bend} ${a.y + lane * 18}, ${b.x - bend} ${b.y + lane * 18}, ${b.x} ${b.y}`;
}

export type CableGesture =
  | { mode: "add"; socket: Socket; kind: Exclude<AudioRoute["kind"], "insert"> }
  | { mode: "source" | "target"; socket: Socket; routes: AudioRoute[] };

export function acceptsSocket(gesture: CableGesture, socket: Socket) {
  if (socket.missing || socket.side === gesture.socket.side) return false;
  if (gesture.mode === "add") {
    return gesture.socket.ports.length === socket.ports.length && (gesture.kind === "custom" || socket.stage === "input");
  }
  return gesture.routes.length === socket.ports.length;
}

/** Reconnecting edits only the chosen endpoint. The other mapping and all per-route controls survive. */
export function connectSockets(gesture: CableGesture, socket: Socket): AudioRoute[] {
  if (!acceptsSocket(gesture, socket)) return [];
  if (gesture.mode === "add") {
    const source = gesture.socket;
    return source.ports.map((port, i) => ({
      id: crypto.randomUUID(), sourceId: source.node, sourcePort: port, sourceStage: source.stage as AudioRoute["sourceStage"],
      targetId: socket.node, targetPort: socket.ports[i], targetStage: socket.stage as AudioRoute["targetStage"], kind: gesture.kind
    }));
  }
  return gesture.routes.map((r, i) => gesture.mode === "source" ? {
    ...r, sourceId: socket.node, sourcePort: socket.ports[i], sourceStage: socket.stage as AudioRoute["sourceStage"]
  } : { ...r, targetId: socket.node, targetPort: socket.ports[i], targetStage: socket.stage as AudioRoute["targetStage"] });
}

export function withRoutingEdit(graph: AudioGraph, routes: AudioRoute[], replace: boolean): AudioGraph {
  if (!replace) return { ...graph, routes: [...graph.routes, ...routes] };
  const changes = new Map(routes.map(r => [r.id, r]));
  return { ...graph, routes: graph.routes.map(r => changes.get(r.id) ?? r) };
}
