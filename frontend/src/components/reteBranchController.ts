import type { AreaPlugin } from "rete-area-plugin";
import type { NodePosition, OpcodeSpec, PatchGraph } from "../types";
import { branchCollapsed, controlFlowOwners } from "../lib/controlFlow";
import { branchOpcodeAllowed } from "../lib/branchTransfer";
import { applyNodePositions, BRANCH_CONTENT_TOP, BRANCH_PADDING, clampNodesToBranch, containsPoint, layoutBranches, previewNodeDrag, type BranchLayout, type BranchRect, type BranchTarget, type NodeSize } from "../lib/branchLayout";

export interface BranchRegionLabel extends BranchTarget { title: string }
export interface BranchEditorActions {
  validate: (ids: string[], target: BranchTarget | null) => string[];
  transfer: (graph: PatchGraph, ids: string[], target: BranchTarget | null) => void;
  expand: (blockId: string) => void;
}
interface Options {
  area: AreaPlugin<any, any>;
  container: HTMLElement;
  patchToRete: Map<string, { id: string; selected?: boolean }>;
  getGraph: () => PatchGraph;
  selected: () => string[];
  ready: () => boolean;
  commit: (graph: PatchGraph) => void;
  actions: () => BranchEditorActions | undefined;
  labels: () => BranchRegionLabel[];
  message: (text: string) => void;
  copy: (key: "dropInto" | "dropRejected" | "expandToDrop" | "mainOnly") => string;
  cache: { get: () => BranchLayout | undefined; set: (value: BranchLayout) => void };
}
interface Gesture {
  before: PatchGraph;
  layout: BranchLayout;
  primary: string;
  selected: string[];
  start: NodePosition;
  pointer: NodePosition;
  alt: boolean;
  moved: boolean;
  preview: PatchGraph;
  previewLayout: BranchLayout;
  transfer: boolean;
  ending: boolean;
  preserveSelection: boolean;
}

/** Owns temporary branch drag previews. Only completed gestures reach the store. */
export function createReteBranchController(options: Options) {
  const { area, container, patchToRete } = options;
  let disposed = false; let painting = false; let scheduled = 0;
  let gesture: Gesture | null = null;
  let cancelledDrag = false;
  let previewQueued = false;
  let layout: BranchLayout = { frames: [], positions: {}, blocks: {} };
  let sizes: Record<string, NodeSize> = {};
  let queue = Promise.resolve();
  const frames = new Map<string, HTMLDivElement>();
  const observed = new Set<Element>();
  const key = (r: BranchTarget) => `${r.blockId}:${r.caseId}`;
  const enabled = () => Object.keys(options.getGraph().control_flow ?? {}).length > 0;
  const point = (x: number, y: number) => {
    const rect = container.getBoundingClientRect(); const t = area.area.transform;
    return { x: (x - rect.left - t.x) / t.k, y: (y - rect.top - t.y) / t.k };
  };
  const measure = () => {
    const next: Record<string, NodeSize> = {};
    for (const [id, node] of patchToRete) {
      const view = area.nodeViews.get(node.id); if (!view) continue;
      const body = view.element.querySelector('[data-testid="node"]');
      if (!body) continue;
      const boxes = [body, ...view.element.querySelectorAll('[data-node-actions]')].map((element) => {
        if (!observed.has(element)) { observer.observe(element); observed.add(element); }
        return element.getBoundingClientRect();
      }).filter((r) => r.width > 0 && r.height > 0);
      if (!boxes.length) continue;
      const k = area.area.transform.k;
      next[id] = { width: (Math.max(...boxes.map((r) => r.right)) - Math.min(...boxes.map((r) => r.left))) / k,
        height: (Math.max(...boxes.map((r) => r.bottom)) - Math.min(...boxes.map((r) => r.top))) / k };
    }
    // Ignore floating-point jitter introduced by CSS scaling.
    sizes = Object.fromEntries(Object.entries(next).map(([id, size]) => [id, { width: Math.round(size.width * 100) / 100, height: Math.round(size.height * 100) / 100 }]));
    return patchToRete.size === Object.keys(next).length;
  };
  const drawFrames = (value: BranchLayout, hover?: { frame: BranchRect; error: string }) => {
    const present = new Set(value.frames.map(key));
    for (const [id, element] of frames) if (!present.has(id)) { element.remove(); frames.delete(id); }
    for (const rect of value.frames) {
      const id = key(rect); let element = frames.get(id);
      if (!element) {
        element = document.createElement("div"); element.className = "vs-case-region";
        element.dataset.branchId = rect.blockId; element.dataset.caseId = rect.caseId;
        Object.assign(element.style, { position: "absolute", pointerEvents: "none", boxSizing: "border-box", border: "1px solid #a855f780", borderRadius: "14px", background: "#a855f709", color: "#d8b4fe", padding: "12px 24px", fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
        area.area.content.holder.prepend(element); frames.set(id, element);
      }
      const active = hover && key(hover.frame) === id;
      element.dataset.dropState = active ? hover.error ? "invalid" : "valid" : "none";
      element.style.borderColor = active ? hover.error ? "#fb7185" : "#67e8f9" : "#a855f780";
      element.style.boxShadow = active ? `inset 0 0 0 2px ${hover.error ? "#fb7185" : "#67e8f9"}` : "none";
      element.textContent = options.labels().find((r) => key(r) === id)?.title ?? "";
      Object.assign(element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    }
  };
  const drawPositions = async (positions: Record<string, NodePosition>) => {
    painting = true;
    try {
      for (const [id, pos] of Object.entries(positions)) {
        if (disposed) return;
        const node = patchToRete.get(id); const view = node && area.nodeViews.get(node.id);
        if (view && (Math.abs(view.position.x - pos.x) > .01 || Math.abs(view.position.y - pos.y) > .01)) await area.translate(node!.id, pos);
      }
    } finally { painting = false; }
  };
  const remember = (value: BranchLayout, graph: PatchGraph) => {
    const old = options.cache.get();
    const hidden = (old?.frames ?? []).filter((r) => branchCollapsed(graph, r.blockId) && graph.control_flow?.[r.blockId]?.cases.some((c) => c.id === r.caseId)).map((r) => {
      const a = old!.blocks[r.blockId]; const b = value.blocks[r.blockId];
      return a && b ? { ...r, x: r.x + b.x - a.x, y: r.y + b.y - a.y } : r;
    });
    options.cache.set({ ...value, frames: [...value.frames, ...hidden] });
  };
  const positionsChanged = (graph: PatchGraph, value: BranchLayout) => graph.nodes.some((n) => {
    const p = value.positions[n.id]; return p && (Math.abs(p.x - n.position.x) > .01 || Math.abs(p.y - n.position.y) > .01);
  });
  const refresh = async () => {
    if (disposed || gesture || !options.ready()) return;
    // React may not have mounted every node when Rete finishes initialization.
    // Applying fallback sizes first would reinterpret saved member offsets and
    // shift them again when the real bodies arrive.
    if (!measure()) { schedule(); return; }
    const graph = options.getGraph();
    layout = layoutBranches(graph, sizes, options.cache.get());
    drawFrames(layout); await drawPositions(layout.positions);
    if (disposed || gesture) return;
    remember(layout, graph);
    if (positionsChanged(graph, layout)) options.commit(applyNodePositions(options.getGraph(), layout.positions));
  };
  const schedule = () => {
    if (disposed || scheduled) return;
    scheduled = requestAnimationFrame(() => { scheduled = 0; queue = queue.then(refresh); });
  };
  const observer = new ResizeObserver(schedule);
  const targetAt = (p: NodePosition, value = layout) => value.frames.find((r) => containsPoint(r, p));
  const collapsedAt = (p: NodePosition) => options.getGraph().nodes.find((n) => options.getGraph().control_flow?.[n.id] && branchCollapsed(options.getGraph(), n.id) && containsPoint({ ...n.position, ...(sizes[n.id] ?? { width: 320, height: 180 }) }, p));
  const hoverTransfer = (ids: string[], p: NodePosition, value: BranchLayout) => {
    const target = targetAt(p, value);
    const errors = options.actions()?.validate(ids, target ?? null) ?? [];
    drawFrames(value, target ? { frame: target, error: errors.join("\n") } : undefined);
    const label = target && options.labels().find((r) => key(r) === key(target))?.title;
    options.message(collapsedAt(p) ? options.copy("expandToDrop") : errors.length ? `${options.copy("dropRejected")}\n${errors.join("\n")}` : label ? `${options.copy("dropInto")} ${label}` : "");
  };
  const down = (event: PointerEvent) => {
    cancelledDrag = false;
    if (!enabled() || !options.ready() || event.button !== 0 || painting) return;
    const element = event.target as HTMLElement;
    if (element.closest('button,input,select,textarea,[data-testid="input-socket"],[data-testid="output-socket"]')) return;
    const primary = element.closest<HTMLElement>('[data-patch-node]')?.dataset.patchNode;
    if (!primary) return;
    const before = options.getGraph();
    if (Object.values(before.control_flow ?? {}).some((b) => b.cases.some((c) => c.result_node_id === primary))) return;
    const start = point(event.clientX, event.clientY);
    gesture = { before, layout, primary, selected: [], start, pointer: start, alt: event.altKey, moved: false, preview: before, previewLayout: layout, transfer: false, ending: false,
      preserveSelection: options.selected().includes(primary) };
    options.message("");
  };
  const updateGesture = async (active: Gesture) => {
    if (disposed || gesture !== active) return;
    const delta = { x: active.pointer.x - active.start.x, y: active.pointer.y - active.start.y };
    if (!active.moved && Math.hypot(delta.x, delta.y) * area.area.transform.k < 3) return;
    if (!active.moved) {
      const selected = options.selected(); active.selected = selected.includes(active.primary) ? selected : [active.primary];
      const owners = controlFlowOwners(active.before);
      const hasMembers = active.selected.some((id) => owners.has(id));
      const hasBlock = active.selected.some((id) => active.before.control_flow?.[id]);
      active.transfer = !hasBlock && (active.alt || !hasMembers);
      active.moved = true;
    }
    active.preview = previewNodeDrag(active.before, active.selected, delta, active.layout, active.transfer);
    active.previewLayout = active.transfer ? active.layout : layoutBranches(active.preview, sizes, active.layout);
    if (!active.transfer) active.preview = applyNodePositions(active.preview, active.previewLayout.positions);
    if (active.transfer) hoverTransfer(active.selected, active.pointer, active.layout); else drawFrames(active.previewLayout);
    await drawPositions(Object.fromEntries(active.preview.nodes.map((n) => [n.id, n.position])));
  };
  const move = (event: PointerEvent) => {
    const active = gesture; if (!active || active.ending) return;
    active.pointer = point(event.clientX, event.clientY);
    if (previewQueued) return;
    previewQueued = true;
    queue = queue.then(async () => { previewQueued = false; await updateGesture(active); });
  };
  const finish = (cancel: boolean, event?: PointerEvent) => {
    const active = gesture; if (!active || active.ending) return;
    active.ending = true;
    // Rete still owns the pointer until release. Suppress its remaining movement
    // after Escape/blur as well as the preview, until the next pointer gesture.
    cancelledDrag = cancel;
    if (event) active.pointer = point(event.clientX, event.clientY);
    queue = queue.then(async () => {
      if (disposed || gesture !== active) return;
      if (!cancel) await updateGesture(active);
      gesture = null;
      drawFrames(layout);
      if (cancel || !active.moved) { options.message(""); await drawPositions(Object.fromEntries(options.getGraph().nodes.map((n) => [n.id, n.position]))); return; }
      const next = applyNodePositions(options.getGraph(), Object.fromEntries(active.preview.nodes.map((n) => [n.id, n.position])));
      if (active.transfer) {
        const collapsed = collapsedAt(active.pointer);
        if (collapsed) {
          await drawPositions(Object.fromEntries(options.getGraph().nodes.map((n) => [n.id, n.position])));
          options.message(options.copy("expandToDrop")); options.actions()?.expand(collapsed.id); return;
        }
        const target = targetAt(active.pointer, active.layout) ?? null;
        const errors = options.actions()?.validate(active.selected, target) ?? [];
        if (errors.length) {
          await drawPositions(Object.fromEntries(options.getGraph().nodes.map((n) => [n.id, n.position])));
          options.message(`${options.copy("dropRejected")}\n${errors.join("\n")}`); return;
        }
        options.message("");
        if (target || active.alt) options.actions()?.transfer(target ? clampNodesToBranch(next, active.selected, target) : next, active.selected, target); else options.commit(next);
      } else { layout = active.previewLayout; remember(layout, next); options.message(""); options.commit(next); }
      schedule();
    });
  };
  const up = (event: PointerEvent) => finish(false, event);
  const cancel = () => finish(true);
  const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && gesture) { event.preventDefault(); finish(true); } };
  container.addEventListener("pointerdown", down, true);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", escape);
  window.addEventListener("blur", cancel);
  return {
    painting: () => painting,
    dragging: () => gesture !== null || cancelledDrag,
    preserveSelection: () => gesture?.preserveSelection ?? false,
    refresh: schedule,
    refreshNow: () => { queue = queue.then(refresh); return queue; },
    clearHover: () => { drawFrames(layout); options.message(""); },
    catalogHover: (opcode: string | null, x: number, y: number) => {
      const p = point(x, y); const target = targetAt(p);
      const error = target && opcode && !branchOpcodeAllowed(opcode) ? `${options.copy("mainOnly")} ${opcode}` : "";
      drawFrames(layout, target ? { frame: target, error } : undefined);
      options.message(collapsedAt(p) ? options.copy("expandToDrop") : error || (target ? `${options.copy("dropInto")} ${options.labels().find((r) => key(r) === key(target))?.title ?? ""}` : ""));
    },
    catalogDrop: (opcode: OpcodeSpec, x: number, y: number, add: (position: NodePosition, target?: BranchTarget) => void) => {
      const p = point(x, y); const collapsed = collapsedAt(p); drawFrames(layout);
      if (collapsed) { options.message(options.copy("expandToDrop")); options.actions()?.expand(collapsed.id); return; }
      const target = targetAt(p);
      if (target && !branchOpcodeAllowed(opcode.name)) { options.message(`${options.copy("mainOnly")} ${opcode.name}`); return; }
      const position = target ? { x: Math.max(p.x, target.x + BRANCH_PADDING), y: Math.max(p.y, target.y + BRANCH_CONTENT_TOP) } : p;
      try { add(position, target); options.message(""); } catch (error) { options.message(`${options.copy("dropRejected")}\n${String(error)}`); }
    },
    destroy: () => {
      disposed = true; gesture = null; cancelAnimationFrame(scheduled); observer.disconnect();
      container.removeEventListener("pointerdown", down, true); window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape); window.removeEventListener("blur", cancel);
      frames.forEach((element) => element.remove());
    }
  };
}

export type ReteBranchController = ReturnType<typeof createReteBranchController>;
