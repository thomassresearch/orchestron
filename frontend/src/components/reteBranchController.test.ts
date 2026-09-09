import { afterEach, describe, expect, it, vi } from "vitest";
import { createReteBranchController } from "./reteBranchController";
import { addControlFlowBlock, controlFlowOwners, setBranchCollapsed } from "../lib/controlFlow";
import { addBranchNode, branchTransferIssues, transferBranchNodes } from "../lib/branchTransfer";
import { audioTemplate } from "../lib/audioTemplates";
import type { BranchLayout, BranchTarget } from "../lib/branchLayout";
import type { NodePosition, OpcodeSpec } from "../types";

// Small rendering adapter: pointer events exercise the actual controller's
// transaction and scheduling code; no Rete or browser state is persisted here.
class ElementStub extends EventTarget {
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = "";
  textContent = "";
  remove = vi.fn();
  closest(selector: string) { return selector === "[data-patch-node]" ? this : null; }
}
function fire(target: EventTarget, type: string, values: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
  return event;
}
function fixture({ member = false, connected = false, zoom = 1 } = {}) {
  const win = new EventTarget(); const container = new ElementStub(); const frames: ElementStub[] = [];
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", { createElement: () => new ElementStub() });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", () => {});
  let graph = addControlFlowBlock(audioTemplate("empty").graph, "if", { x: 50, y: 50 });
  const blockId = Object.keys(graph.control_flow!)[0]; const first = graph.control_flow![blockId].cases[0];
  const target: BranchTarget = { blockId, caseId: first.id };
  const last = graph.control_flow![blockId].cases[1]; const silent = { blockId, caseId: last.id };
  for (const [i, id] of ["a", "b"].entries()) graph = addBranchNode(graph, { id, opcode: "const_a", params: { value: 1 }, position: { x: 700 + i * 220, y: 400 + i * 20 } }, member ? target : undefined);
  if (connected) graph.connections.push({ from_node_id: "a", from_port_id: "aout", to_node_id: "b", to_port_id: "left" });
  graph.ui_layout.editor_state = { viewport: { x: 0, y: 0, k: zoom }, selection: { nodeIds: ["a", "b"], connections: [] } };
  const views = new Map(graph.nodes.map((n) => {
    const element = new ElementStub(); element.dataset.patchNode = n.id;
    const view = { position: { ...n.position }, element };
    const body = { getBoundingClientRect: () => ({ left: view.position.x * zoom, top: view.position.y * zoom, right: (view.position.x + 180) * zoom, bottom: (view.position.y + (n.id === "a" ? 650 : 160)) * zoom, width: 180 * zoom, height: (n.id === "a" ? 650 : 160) * zoom }) };
    Object.assign(element, { querySelector: () => body, querySelectorAll: () => [] });
    return [n.id, view] as const;
  }));
  Object.assign(container, { getBoundingClientRect: () => ({ left: 0, top: 0 }) });
  const area = { nodeViews: views, area: { transform: { x: 0, y: 0, k: zoom }, content: { holder: { prepend: (e: ElementStub) => frames.push(e) } } }, translate: async (id: string, p: NodePosition) => { views.get(id)!.position = { ...p }; } };
  let cache: BranchLayout | undefined;
  let selected = ["a", "b"];
  const commit = vi.fn((next) => { graph = next; }); const message = vi.fn(); const expand = vi.fn((id) => { graph = setBranchCollapsed(graph, id, false); });
  const controller = createReteBranchController({ area: area as any, container: container as unknown as HTMLElement,
    patchToRete: new Map(graph.nodes.map((n) => [n.id, { id: n.id }])), getGraph: () => graph, selected: () => selected, ready: () => true,
    commit, actions: () => ({ validate: (ids, dest) => branchTransferIssues(graph, ids, dest), transfer: (next, ids, dest) => commit(transferBranchNodes(next, ids, dest)), expand }),
    labels: () => graph.control_flow![blockId].cases.map((c) => ({ blockId, caseId: c.id, title: c.name })), message, copy: (key) => key,
    cache: { get: () => cache, set: (next) => { cache = next; } } });
  let pointer = { x: 0, y: 0 };
  const down = (id = "a", alt = false) => {
    const p = views.get(id)!.position;
    pointer = { x: p.x + 5, y: p.y + 5 };
    return fire(container, "pointerdown", { target: views.get(id)!.element, button: 0, altKey: alt, clientX: (p.x + 5) * zoom, clientY: (p.y + 5) * zoom });
  };
  const move = (p: NodePosition, altKey = false) => { pointer = p; fire(win, "pointermove", { clientX: p.x * zoom, clientY: p.y * zoom, altKey }); };
  const up = () => fire(win, "pointerup", { clientX: pointer.x * zoom, clientY: pointer.y * zoom });
  const destination = (index = 0) => ({ x: cache!.frames[index].x + 100, y: cache!.frames[index].y + 100 });
  return { controller, views, frames, area, down, move, up, win, commit, message, expand, destination, target, silent,
    graph: () => graph, cache: () => cache!, select: (ids: string[]) => { selected = ids; } };
}
afterEach(() => vi.unstubAllGlobals());

describe("branch drag transactions", () => {
  it("waits for every rendered body before normalizing a restored layout", async () => {
    const f = fixture({ member: true });
    const element = f.views.get(f.target.blockId)!.element as any;
    const mounted = element.querySelector; element.querySelector = () => null;
    const before = structuredClone(f.graph()); await f.controller.refreshNow();
    expect(f.commit).not.toHaveBeenCalled(); expect(f.graph()).toEqual(before);
    element.querySelector = mounted; await f.controller.refreshNow();
    const normalized = structuredClone(f.graph()); await f.controller.refreshNow();
    expect(f.graph()).toEqual(normalized); f.controller.destroy();
  });
  it("previews a whole group, highlights a valid target and atomically converts Silence on release", async () => {
    const f = fixture({ connected: true }); await f.controller.refreshNow(); f.commit.mockClear();
    const before = structuredClone(f.graph()); f.down(); f.move(f.destination(1)); await f.controller.refreshNow();
    expect(f.controller.preserveSelection()).toBe(true);
    expect(f.graph()).toEqual(before); expect(f.commit).not.toHaveBeenCalled();
    expect(f.frames.find((e) => e.dataset.caseId === f.silent.caseId)!.dataset.dropState).toBe("valid");
    f.up(); await f.controller.refreshNow();
    expect(controlFlowOwners(f.graph()).get("a")).toEqual(f.silent);
    expect(controlFlowOwners(f.graph()).get("b")).toEqual(f.silent);
    expect(f.graph().control_flow![f.target.blockId].cases[1].silence).toBe(false);
    expect(f.graph().connections).toEqual(before.connections); expect(f.graph().ui_layout.editor_state).toEqual(before.ui_layout.editor_state);
    expect(f.graph().ui_layout.input_formulas).toEqual(before.ui_layout.input_formulas);
    expect(f.views.get("b")!.position.x - f.views.get("a")!.position.x).toBe(220);
    f.controller.destroy();
  });
  it("refuses incomplete groups and restores every preview position without changing Silence", async () => {
    const f = fixture({ connected: true }); await f.controller.refreshNow(); f.commit.mockClear(); f.select(["a"]);
    const before = structuredClone(f.graph()); f.down(); f.move(f.destination(1)); await f.controller.refreshNow();
    expect(f.frames.find((e) => e.dataset.caseId === f.silent.caseId)!.dataset.dropState).toBe("invalid");
    expect(f.message).toHaveBeenLastCalledWith(expect.stringContaining("a.aout → b.left"));
    f.up(); await f.controller.refreshNow(); expect(f.graph()).toEqual(before);
    for (const n of before.nodes) expect(f.views.get(n.id)!.position).toEqual(n.position);
    expect(f.commit).not.toHaveBeenCalled(); f.controller.destroy();
  });
  it.each(["Escape", "pointercancel", "blur"])("rolls back on %s and ignores subsequent movement until release", async (reason) => {
    const f = fixture(); await f.controller.refreshNow(); f.commit.mockClear(); const before = structuredClone(f.graph());
    f.down(); f.move(f.destination()); await f.controller.refreshNow();
    fire(f.win, reason === "Escape" ? "keydown" : reason, { key: reason }); await f.controller.refreshNow();
    f.move({ x: 1200, y: 1800 }); f.up(); await f.controller.refreshNow();
    expect(f.graph()).toEqual(before); expect(f.commit).not.toHaveBeenCalled();
    for (const n of before.nodes) expect(f.views.get(n.id)!.position).toEqual(n.position);
    expect(f.frames.every((e) => e.dataset.dropState === "none")).toBe(true); f.controller.destroy();
  });
  it("captures Alt at drag start, allows transfer out and keeps ordinary branch drags in scope", async () => {
    const f = fixture({ member: true, connected: true }); await f.controller.refreshNow();
    f.down(); f.move({ x: -300, y: -300 }, true); f.up(); await f.controller.refreshNow();
    expect(controlFlowOwners(f.graph()).get("a")).toEqual(f.target);
    expect(f.views.get("a")!.position.x).toBe(f.cache().frames[0].x + 24);
    f.down("a", true); f.move({ x: -300, y: -300 }); f.up(); await f.controller.refreshNow();
    expect(controlFlowOwners(f.graph()).has("a")).toBe(false);
    expect(controlFlowOwners(f.graph()).has("b")).toBe(false);
    expect(f.views.get("a")!.position.x).toBeLessThan(0); f.controller.destroy();
  });
  it.each([0.25, 1, 2])("measures tall bodies in graph units at zoom %s", async (zoom) => {
    const f = fixture({ member: true, zoom }); await f.controller.refreshNow();
    const result = f.cache().frames[0].resultNodeId;
    expect(f.views.get(result)!.position.y - f.views.get("a")!.position.y).toBe(650 + 24);
    f.controller.destroy();
  });
  it("uses catalog identity for hover rejection and requests expansion without choosing a case", async () => {
    const f = fixture(); await f.controller.refreshNow(); const p = f.destination(1); const add = vi.fn();
    f.controller.catalogHover("outs", p.x, p.y);
    expect(f.frames.find((e) => e.dataset.caseId === f.silent.caseId)!.dataset.dropState).toBe("invalid");
    f.controller.catalogDrop({ name: "outs" } as OpcodeSpec, p.x, p.y, add); expect(add).not.toHaveBeenCalled();
    f.controller.catalogDrop({ name: "oscili" } as OpcodeSpec, p.x, p.y, add); expect(add).toHaveBeenCalledWith(p, expect.objectContaining(f.silent));
    Object.assign(f.graph(), setBranchCollapsed(f.graph(), f.target.blockId, true)); await f.controller.refreshNow(); add.mockClear();
    f.controller.catalogDrop({ name: "oscili" } as OpcodeSpec, 80, 80, add);
    expect(add).not.toHaveBeenCalled(); expect(f.expand).toHaveBeenCalledWith(f.target.blockId); f.controller.destroy();
  });
  it("retains the largest ordinary drag preview even when the pointer returns inward", async () => {
    const f = fixture({ member: true }); await f.controller.refreshNow(); f.commit.mockClear();
    const before = structuredClone(f.graph()); const initial = f.cache().frames[0];
    const start = { ...f.views.get("a")!.position }; f.down();
    f.move({ x: start.x + 505, y: start.y + 305 }); await f.controller.refreshNow();
    f.move({ x: start.x + 5, y: start.y + 5 }); await f.controller.refreshNow();
    expect(f.graph()).toEqual(before); expect(f.commit).not.toHaveBeenCalled();
    f.up(); await f.controller.refreshNow();
    expect(f.cache().frames[0]).toMatchObject({ width: initial.width + 500, height: initial.height + 300 });
    expect(f.views.get("a")!.position).toEqual(start);
    f.controller.destroy();
  });
  it.each([0.25, 1, 2])("resizes only the result's case, preserves selection and clamps at zoom %s", async (zoom) => {
    const f = fixture({ member: true, connected: true, zoom }); await f.controller.refreshNow();
    const initial = structuredClone(f.cache()); const before = structuredClone(f.graph()); const result = initial.frames[0].resultNodeId;
    const start = { ...f.views.get(result)!.position };
    // a and b remain selected. Alt must not turn a result resize into a transfer.
    expect(f.down(result, true).defaultPrevented).toBe(true);
    expect(f.controller.preserveSelection()).toBe(true);
    f.move({ x: start.x + 205, y: start.y + 305 }); await f.controller.refreshNow();
    expect(f.graph()).toEqual(before);
    expect(f.views.get(result)!.position).toEqual({ x: start.x + 200, y: start.y + 300 });
    for (const id of ["a", "b"]) expect(f.views.get(id)!.position).toEqual(initial.positions[id]);
    f.up(); await f.controller.refreshNow();
    expect(f.cache().frames[0]).toMatchObject({ width: initial.frames[0].width + 200, height: initial.frames[0].height + 300 });
    expect(f.cache().frames[1].y).toBe(initial.frames[1].y + 300);
    expect(f.graph().ui_layout.editor_state).toEqual(before.ui_layout.editor_state);
    expect(f.graph().connections).toEqual(before.connections); expect(f.graph().control_flow).toEqual(before.control_flow);
    f.down(result); f.move({ x: -9000, y: -9000 }); f.up(); await f.controller.refreshNow();
    expect(f.cache()).toEqual(initial); expect(f.graph()).toEqual(before);
    f.controller.destroy();
  });
  it("resizes a Silence marker without activating synthesis", async () => {
    const f = fixture(); await f.controller.refreshNow(); const initial = structuredClone(f.cache());
    const result = initial.frames[1].resultNodeId; const start = f.views.get(result)!.position;
    f.down(result); f.move({ x: start.x + 405, y: start.y + 205 }); f.up(); await f.controller.refreshNow();
    expect(f.cache().frames[1]).toMatchObject({ width: initial.frames[1].width + 400, height: initial.frames[1].height + 200 });
    expect(f.graph().control_flow![f.silent.blockId].cases[1].silence).toBe(true);
    expect(f.cache().frames[0]).toEqual(initial.frames[0]); f.controller.destroy();
  });
  it.each(["Escape", "pointercancel", "blur"])("restores dimensions, reflow and positions after cancelled resize or growth: %s", async (reason) => {
    for (const resize of [true, false]) {
      const f = fixture({ member: true }); await f.controller.refreshNow(); f.commit.mockClear();
      const before = structuredClone(f.graph()); const initial = structuredClone(f.cache());
      const id = resize ? initial.frames[0].resultNodeId : "a"; const start = f.views.get(id)!.position;
      f.down(id); f.move({ x: start.x + 805, y: start.y + 605 }); await f.controller.refreshNow();
      fire(f.win, reason === "Escape" ? "keydown" : reason, { key: reason }); await f.controller.refreshNow();
      f.up(); await f.controller.refreshNow();
      expect(f.graph()).toEqual(before); expect(f.cache()).toEqual(initial); expect(f.commit).not.toHaveBeenCalled();
      for (const n of before.nodes) expect(f.views.get(n.id)!.position).toEqual(n.position);
      f.controller.destroy();
    }
  });
  it("keeps opaque borders at two screen pixels and hover at three without changing geometry", async () => {
    const f = fixture(); await f.controller.refreshNow(); const before = structuredClone(f.graph());
    const frame = f.frames[0]; const width = frame.style.width; const height = frame.style.height;
    for (const zoom of [0.1, 0.25, 1, 2]) {
      f.area.area.transform.k = zoom; f.controller.updateBorders();
      expect(frame.style.outline).toBe(`${2 / zoom}px solid #c084fc`);
      const p = f.destination(); f.controller.catalogHover("oscili", p.x * zoom, p.y * zoom);
      expect(frame.style.outline).toBe(`${3 / zoom}px solid #67e8f9`);
      f.controller.catalogHover("outs", p.x * zoom, p.y * zoom);
      expect(frame.style.outline).toBe(`${3 / zoom}px solid #fb7185`);
      f.controller.clearHover();
      expect(frame.style.width).toBe(width); expect(frame.style.height).toBe(height);
      expect(f.graph()).toEqual(before);
    }
    f.controller.destroy();
  });
});
