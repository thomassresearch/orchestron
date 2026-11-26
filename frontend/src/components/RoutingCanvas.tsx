import { useEffect, useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { audioCopy } from "../lib/audioCopy";
import { MASTER, previewAudioFeedback } from "../lib/audioRouting";
import {
  acceptsSocket, cablePath, cardWidth, connectSockets, firstSocketY, OUTPUT, routingCanvas, rowHeight, socketPoint, withRoutingEdit,
  type Cable, type CableGesture, type Point, type Socket
} from "../lib/routingCanvas";
import type { AudioDiagnostic, AudioGraph, AudioRoute, GuiLanguage, MixerState, PatchListItem, SequencerInstrumentBinding } from "../types";
import { useAppStore } from "../store/useAppStore";
import { Gain } from "./MixerStripControls";
import { MixerFeedbackDiagnostics } from "./MixerFeedbackDiagnostics";
import { SEQUENCER_UI_COPY } from "./sequencer/sequencerUiCopy";
import { usePerformanceEditorState } from "./sequencer/PerformanceEditorState";
import { useRoutingViewport } from "./useRoutingViewport";
import { RoutingInsertList } from "./RoutingInsertList";
import { RoutingJackMenu, type JackMenu } from "./RoutingJackMenu";
import "./routingCanvas.css";

type Props = {
  bindings: SequencerInstrumentBinding[]; patches: PatchListItem[]; graph: AudioGraph; mixer: MixerState; language: GuiLanguage;
  running: boolean; exact: boolean; setExact: (value: boolean) => void;
  selected: string; select: (id: string) => void; diagnostics: AudioDiagnostic[]; onlyFeedback: boolean;
  setOnlyFeedback: (value: boolean) => void; onCheck: () => void; checking?: boolean; repairMaster?: () => void;
  routeGroups: AudioRoute[][];
  validationError: string | null; onRemove: (rs: AudioRoute[]) => void; onError: (message: string | null) => void;
  nodeActions: (id: string) => ReactNode; diagnosticText: (d: AudioDiagnostic) => string;
  onInsert: (owner: string, patchId: string, index: number) => void;
  onMove: (owner: string, chain: string[], from: number, to: number) => void; onEdit: (id: string) => void;
};
const kindLabel = (kind: AudioRoute["kind"]) => kind === "insert" ? "inserts" : kind;
const cardDirections: Partial<Record<string, Point>> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }
};
const stageLabel = (s: Socket) => s.stage === "raw" ? "rawStage" : s.stage === "input" ? "inputStage" : s.side === "in" ? "insertReturn" : "stripStage";
function isCompatibleJack(viewport: HTMLElement | null, target?: EventTarget | null) {
  return target instanceof Element && viewport?.contains(target.closest(".rc-socket[data-compatible]"));
}

export function RoutingCanvas({ bindings, patches, graph, mixer, language, exact, setExact, running, selected, select,
  diagnostics, onlyFeedback, setOnlyFeedback, onCheck, checking, repairMaster, routeGroups, validationError, onRemove, onError, nodeActions, diagnosticText, onInsert, onMove, onEdit }: Props) {
  const sends = mixer.sends;
  const [stages, setStages] = usePerformanceEditorState("mixer", "routingStages", false);
  const layout = useAppStore(s => s.routingLayout);
  const model = useMemo(() => routingCanvas(bindings, patches, graph, sends, exact, stages, layout), [bindings, patches, graph, sends, exact, stages, layout]);
  const generation = useAppStore(s => s.performanceWorkspaceGeneration);
  const [draft, setDraft] = useState<{id: string; point: Point; generation: number} | null>(null);
  const positions = draft?.generation === generation ? {...layout, [draft.id]:draft.point} : layout;
  const loops = diagnostics.filter(d => d.code === "feedback");
  const loopRoutes = new Set(loops.flatMap(d => d.routeIds ?? []));
  const loopNodes = new Set(loops.flatMap(d => d.instanceIds ?? []));
  const filter = onlyFeedback && loops.length > 0;
  const visible = filter ? new Map([...model.nodes].filter(([id]) => loopNodes.has(id))) : model.nodes;
  const cards = [...visible.values()].map(n => ({ ...positions[n.id] ?? n, height: n.height }));
  const viewport = useRoutingViewport(visible, positions);
  const filteredIds = filter ? JSON.stringify([...visible.keys()]) : "";
  useEffect(() => {
    if (filteredIds && viewport.plane) viewport.fit();
  }, [filteredIds, viewport.plane]);
  const [pending, setGesture] = useState<{gesture: CableGesture; graph: AudioGraph; exact: boolean} | null>(null);
  const gesture = useMemo(() => {
    if (!pending || pending.graph !== graph || pending.exact !== exact || running) return null;
    const old = pending.gesture.socket;
    const n = model.nodes.get(old.node);
    const socket = (old.side === "out" ? n?.outputs : n?.inputs)?.find(s => s.stage === old.stage && s.ports.length === old.ports.length && s.ports.every((p,i) => p === old.ports[i]));
    return socket ? {...pending.gesture, socket} : null;
  }, [pending, graph, exact, running, model]);
  const [hover, setHover] = useState<Socket | null>(null);
  const [selection, choose] = usePerformanceEditorState<string | null>("mixer", "selectedCable", null);
  const [nodeId, showNode] = useState<string | null>(null);
  const [menu, setMenu] = useState<JackMenu | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const reportId = useId();
  const checkButton = useRef<HTMLButtonElement>(null);
  const hasStrip = (id: string) => id === MASTER || !!model.nodes.get(id)?.binding;
  const menuTarget = (anchor: HTMLElement | SVGElement, point?: Point) => {
    const rect = anchor.getBoundingClientRect();
    return {anchor, x:point?.x ?? rect.left, y:point?.y ?? rect.bottom};
  };
  const [channelId, setChannelId] = useState<string | null>(null);
  const drag = useRef<{ id: string; pointer: number; start: Point; position: Point; generation: number; moved?: Point } | null>(null);
  const wire = useRef<SVGPathElement>(null);
  const t = audioCopy(language);
  const name = (id: string) => id === OUTPUT ? t("audioOutput") : id === MASTER ? t("master") : model.nodes.get(id)?.patch?.name ?? id;
  const label = (id: string) => {
    const number = model.nodes.get(id)?.number;
    return number ? name(id) + " · " + SEQUENCER_UI_COPY[language].patch(number) : name(id);
  };
  const at = (s: Socket) => socketPoint(model.nodes.get(s.node)!, s, positions[s.node]);
  const selectedCable = model.cables.find(c => c.implicit ? c.key === selection : c.routes.some(r => r.id === selection));
  const inspected = model.nodes.get(nodeId && !model.nodes.get(nodeId)?.binding && nodeId !== MASTER ? nodeId : selected);
  const selectedChannel = selectedCable?.routes.find(r => r.id && r.id === channelId);
  const inspectedRoutes = selectedChannel ? [selectedChannel] : selectedCable?.routes ?? [];
  const cancel = () => { setGesture(null); setHover(null); };
  const dismissMenu = (outsidePointer?: EventTarget | null) => {
    setMenu(null);
    // A highlighted jack completes the route on click, after pointerdown dismisses the picker.
    if (menu?.mode !== "destinations" || !isCompatibleJack(viewport.host.current, outsidePointer)) cancel();
  };
  const exactReconnect = useRef<{ id: string; mode: "source" | "target"; graph: AudioGraph } | null>(null);
  const previousSelection = useRef(selected);
  useEffect(() => {
    if (selected === previousSelection.current) return;
    previousSelection.current = selected;
    showNode(null); choose(null); setChannelId(null);
  }, [selected, choose]);
  useEffect(() => { cancel(); setMenu(null); }, [graph, bindings, patches, running, exact, generation]);
  useEffect(() => {
    const request = exactReconnect.current;
    if (!request) return;
    exactReconnect.current = null;
    if (!exact || running || request.graph !== graph) return;
    const cable = model.cables.find(c => c.routes.some(r => r.id === request.id));
    if (!cable) return;
    const socket = request.mode === "source" ? cable.target : cable.source;
    const routes = cable.routes.filter(r => r.id === request.id);
    setGesture({ graph, exact, gesture: { mode: request.mode, routes, socket } });
    choose(request.id);
  }, [exact, running, graph, model, choose]);
  useEffect(() => {
    if (!gesture || menu) return;
    const canvas = viewport.host.current?.closest(".routing-canvas");
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    const outside = (e: Event) => {
      if (e.target instanceof Node && !canvas?.contains(e.target)) cancel();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("focusin", outside);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("focusin", outside);
      window.removeEventListener("blur", cancel);
    };
  }, [gesture, menu, viewport.host]);

  function inspectIssue(issue: AudioDiagnostic) {
    const routeId = issue.routeId ?? issue.routeIds?.[0];
    const route = graph.routes.find(r => r.id === routeId);
    const node = model.nodes.get(issue.instanceId ?? issue.instanceIds?.[0] ?? route?.sourceId ?? "");
    setOnlyFeedback(false);
    if (node) {
      if (hasStrip(node.id)) { previousSelection.current = node.id; select(node.id); }
      showNode(node.id);
      viewport.center(node);
    }
    choose(routeId ?? null);
    setChannelId(routeId ?? null);
    cancel();
  }

  const candidate = useMemo(() => gesture && hover ? connectSockets(gesture, hover) : [], [gesture, hover]);
  const preview = useMemo(() => {
    if (!gesture || !candidate.length) return [];
    const next = withRoutingEdit(graph, candidate, gesture.mode !== "add");
    const ids = new Set(candidate.map(r => r.id));
    return previewAudioFeedback(bindings, patches, next).filter(d => d.routeIds?.some(id => ids.has(id)));
  }, [gesture, candidate, graph, bindings, patches]);
  const previewRoutes = new Set(preview.flatMap(d => d.routeIds ?? []));
  const previewNodes = new Set(preview.flatMap(d => d.instanceIds ?? []));
  const faults = new Map<string, AudioDiagnostic[]>();
  for (const d of diagnostics) {
    for (const id of new Set([d.instanceId, ...d.instanceIds ?? []])) {
      if (id) faults.set(id, [...faults.get(id) ?? [], d]);
    }
  }
  const broken = new Set(diagnostics.filter(d => d.code === "broken_route").map(d => d.routeId));
  function start(g: CableGesture) { setGesture({ gesture: g, graph, exact }); setHover(null); onError(null); }
  function activate(s: Socket, anchor?: HTMLButtonElement) {
    if (running || s.missing) return;
    if (gesture && acceptsSocket(gesture, s)) {
      const state = useAppStore.getState();
      if (state.activeSessionState === "running" || state.audioGraph !== graph) { cancel(); return; }
      const changes = connectSockets(gesture, s);
      const next = withRoutingEdit(graph, changes, gesture.mode !== "add");
      if (next.routes.length > 1024) { onError(t("routeLimit")); cancel(); return; }
      state.setAudioGraph(next, gesture.mode === "add" && gesture.kind === "send" ? changes.map(r => r.id) : []);
      choose(changes[0].id); setChannelId(null); onError(null); setMenu(null); cancel();
    } else if (anchor && s.side === "out" && (!gesture || gesture.mode === "add")) {
      if (graph.routes.length + s.ports.length > 1024) { onError(t("routeLimit")); cancel(); return; }
      cancel(); select(s.node); showNode(s.node); setMenu({mode:"kind", socket:s, target:{...menuTarget(anchor), align:"end"}, graph});
    }
  }
  function reconnect(c: Cable, mode: "source" | "target") {
    const from = mode === "source" ? c.target : c.source;
    const original = mode === "source" ? c.source : c.target;
    const port = mode === "source" ? "sourcePort" : "targetPort";
    const routes = [...inspectedRoutes].sort((a, b) => original.ports.indexOf(a[port]) - original.ports.indexOf(b[port]));
    if (!exact && routes.length === 1 && (from.ports.length > 1 || original.ports.length > 1)) {
      exactReconnect.current = { id: routes[0].id, mode, graph };
      setExact(true);
      return;
    }
    start({ mode, socket: from, routes });
  }
  function inspect(c: Cable, anchor: SVGElement, point?: Point) {
    choose(c.implicit ? c.key : c.routes[0].id); setChannelId(null); cancel(); setMenu(null);
    const route = c.routes[0];
    if (running || c.implicit || route.kind !== "insert") return;
    const owner = route.sourceStage === "raw" ? route.sourceId : graph.insertOwners[route.sourceId];
    const node = model.nodes.get(owner);
    if (!node?.serial) return;
    const index = route.targetStage === "strip" && route.targetId === owner ? node.inserts.length : node.inserts.indexOf(route.targetId);
    if (index >= 0) setMenu({mode:"insert", owner, index, graph, target:menuTarget(anchor,point)});
  }
  function savePosition(nodeId: string, point: Point) {
    const routingLayout = Object.fromEntries([...model.nodes].map(([id, node]) => [id, { x: node.x, y: node.y }]));
    routingLayout[nodeId] = point;
    useAppStore.setState({ routingLayout });
  }
  function finishDrag(e: PointerEvent, commit: boolean) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null; setDraft(null);
    const state = useAppStore.getState();
    if (commit && d.moved && d.generation === state.performanceWorkspaceGeneration && model.nodes.has(d.id)) {
      savePosition(d.id, d.moved);
    }
  }
  function move(e: PointerEvent) {
    if (drag.current && e.pointerId === drag.current.pointer) {
      const { id, start, position } = drag.current;
      const k = viewport.view.current!.area.transform.k;
      if (e.clientX === start.x && e.clientY === start.y && !drag.current.moved) return;
      const point = {x:position.x + (e.clientX-start.x)/k, y:position.y + (e.clientY-start.y)/k};
      drag.current.moved = point;
      setDraft({id, point, generation:drag.current.generation});
    } else if (gesture && wire.current) {
      const a = at(gesture.socket), b = viewport.point({ x: e.clientX, y: e.clientY });
      wire.current.setAttribute("d", gesture.socket.side === "out" ? cablePath(a, b) : cablePath(b, a));
    }
  }
  function socket(s: Socket, i: number) {
    const eligible = gesture && acceptsSocket(gesture, s);
    const status = s.missing ? "error" : faults.get(s.node)?.some(d =>
      d.direction === (s.stage === "input" ? "input" : "output") && d.ports?.some(p => s.ports.includes(p))) ? "warning" : undefined;
    const stagePort = s.stage === "raw" || (s.side === "in" && s.stage === "strip");
    const defaultGroup = /^stereo (input|output)$/i.test(s.label);
    const group = defaultGroup ? t(s.side === "out" ? "stereoOutput" : "stereoInput") : s.label;
    const label = stagePort ? t(stageLabel(s)) + (exact ? " · " + s.label : "") : group;
    const full = [name(s.node), t(stageLabel(s)), s.label, s.ports.join(" / ")].join(" · ");
    return <button key={JSON.stringify([s.stage, s.ports])} type="button" className={'rc-socket ' + s.side} data-stage={s.stage}
      data-ports={JSON.stringify(s.ports)} data-compatible={eligible || undefined} data-status={status} aria-label={full} title={full}
      disabled={running || s.missing} style={{ top: firstSocketY + i * rowHeight }}
      onClick={e => activate(s,e.currentTarget)} onPointerEnter={() => { if (gesture && gesture.socket !== s) setHover(s); }} onPointerLeave={() => setHover(null)}
      onFocus={() => { if (gesture) setHover(s); }} onBlur={() => setHover(null)}>{label}</button>;
  }
  const routeKind = selectedCable?.routes[0].kind;
  const detailTitle = selectedCable && name(selectedCable.source.node) + " → " + name(selectedCable.target.node);
  const control = inspectedRoutes[0] && sends[inspectedRoutes[0].id];
  const previewMapping = candidate.length ? name(candidate[0].sourceId) + " " + candidate.map(r => r.sourcePort).join(" / ") +
    " → " + name(candidate[0].targetId) + " " + candidate.map(r => r.targetPort).join(" / ") : "";
  const updateSend = (v: Partial<MixerState["sends"][string]>) => useAppStore.getState().setMixerSend(inspectedRoutes.map(r => r.id), v);
  const flush = () => { void useAppStore.getState().flushMixer().catch(() => undefined); };
  const incoming = inspected && model.cables.filter(c => c.target.node === inspected.id && (!filter || c.routes.some(r => loopRoutes.has(r.id))));
  // Parallel cables or crossed mappings may share a destination group in the original matrix.
  const destinationGroup = selectedCable && !selectedCable.implicit
    ? routeGroups.find(group => group.includes(inspectedRoutes[0])) : undefined;
  const issueCount = diagnostics.length;
  const hasError = !!validationError || diagnostics.some(d => d.severity === "error");

  return <section className="routing-canvas">
    <div className="rc-tools">
      <label><input type="checkbox" checked={exact} onChange={e => setExact(e.target.checked)} /> {t("exactPorts")}</label>
      <label><input type="checkbox" checked={stages} onChange={e => {cancel(); setStages(e.target.checked);}}/> {t("stages")}</label>
      {loops.length > 0 && <label><input type="checkbox" checked={onlyFeedback} onChange={e => setOnlyFeedback(e.target.checked)}/> {t("onlyFeedback")}</label>}
      <button type="button" ref={checkButton} aria-label={t("validate")} aria-expanded={reportOpen} aria-controls={reportOpen ? reportId : undefined}
        aria-describedby={issueCount ? reportId + "-count" : undefined}
        onClick={() => { cancel(); setReportOpen(true); onCheck(); }}>{t("validate")}
        {issueCount > 0 && <span className="rc-issue-count" id={reportId + "-count"} data-status={hasError ? "error" : "warning"}>
          <span className="sr-only">{t("diagnostics")} </span>{issueCount}</span>}</button>
      {repairMaster && <button type="button" disabled={running} onClick={repairMaster}>{t("repairMaster")}</button>}
      <div className="rc-navigation"><button type="button" aria-label={t("zoomOut")} onClick={() => viewport.zoom(.8)}>−</button>
        <button type="button" aria-label={t("zoomIn")} onClick={() => viewport.zoom(1.25)}>+</button>
        <button type="button" onClick={() => viewport.fit()}>{t("fit")}</button></div>
    </div>
    {reportOpen && <section id={reportId} className="rc-report" aria-label={t("diagnostics")}>
      <div className="rc-report-heading"><strong>{t("diagnostics")}</strong>
        <button type="button" onClick={() => { setReportOpen(false); checkButton.current?.focus(); }}>{t("dismiss")}</button></div>
      {checking && <p role="status">{t("checkingRouting")}</p>}
      {checking === false && !issueCount && !validationError && <p role="status">{t("routingClear")}</p>}
      {validationError && <p className="rc-issue" data-status="error" role="alert">{validationError}</p>}
      {diagnostics.filter(d => d.code !== "feedback").map((d, i) => {
        const id = d.instanceId ?? d.instanceIds?.[0];
        const text = (id ? label(id) + " · " : "") + diagnosticText(d);
        return id || d.routeId || d.routeIds?.length
          ? <button key={i} className="rc-issue" data-status={d.severity} onClick={() => inspectIssue(d)}>{text}</button>
          : <p key={i} className="rc-issue" data-status={d.severity}>{text}</p>;
      })}
      <MixerFeedbackDiagnostics diagnostics={loops} language={language} onShow={() => { setReportOpen(false); setOnlyFeedback(true); checkButton.current?.focus(); }}/>
    </section>}
    <div className="rc-viewport" ref={viewport.host} aria-label={t("diagram")} onPointerMove={move}
      onPointerUp={e => finishDrag(e,true)} onPointerCancel={e => {finishDrag(e,false); cancel();}}>
      {viewport.plane && createPortal(<>
        <svg className="rc-wires" aria-label={t("routing")}>{model.cables.map(c => {
          const kind = c.routes[0].kind, ids = c.routes.map(r => r.id), cyclic = ids.filter(id => loopRoutes.has(id));
          if (filter && !cyclic.length) return null;
          const a = at(c.source), b = at(c.target);
          const d = cablePath(a, b, c.lane, cards);
          const label = [name(c.source.node) + " → " + name(c.target.node), t(c.implicit ? "automatic" : kindLabel(kind)),
            c.routes.map(r => r.sourcePort + " → " + r.targetPort).join(", ")].join(" · ");
          return <g key={c.key} data-cable-kind={kind} data-implicit={c.implicit || undefined} data-route-ids={JSON.stringify(c.implicit ? [] : ids)}
            data-feedback-routes={cyclic.length ? cyclic.join(" ") : undefined} data-status={cyclic.length || ids.some(id => broken.has(id) || previewRoutes.has(id)) ? "error" : undefined}
            data-selected={selectedCable === c || undefined} role="button" tabIndex={0} aria-label={label} onPointerDown={e => e.stopPropagation()}
            onClick={e => inspect(c, e.currentTarget, e.detail ? {x:e.clientX,y:e.clientY} : undefined)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inspect(c,e.currentTarget); } }}>
            <title>{label}</title><path className="rc-hit" d={d}/><path className="rc-line" d={d}/>
          </g>;
        })}{gesture && <path className="rc-preview" ref={wire} data-status={preview.length || (hover && !acceptsSocket(gesture, hover)) ? "error" : undefined}
          d={hover ? (gesture.socket.side === "out" ? cablePath(at(gesture.socket), at(hover)) : cablePath(at(hover), at(gesture.socket))) : undefined} />}</svg>
        {[...visible.values()].map(n => {
          const p = positions[n.id] ?? n, messages = faults.get(n.id) ?? [];
          const status = (!n.patch && n.id !== OUTPUT) || previewNodes.has(n.id) || messages.some(d => d.severity === "error") ? "error" : messages.length ? "warning" : undefined;
          const owner = graph.insertOwners[n.id];
          return <article key={n.id} className="rc-node" data-routing-node={n.id} data-status={status} data-selected={!selectedCable && inspected?.id === n.id || undefined}
            data-role={n.id === MASTER ? "master" : n.id === OUTPUT ? "output" : owner ? "insert" : n.patch?.always_on ? "return" : "instrument"}
            style={{ left: p.x, top: p.y, width: cardWidth, height: n.height }} onPointerDown={e => e.stopPropagation()}>
            <button type="button" className="rc-title" aria-description={t("moveCardHint")} title={[name(n.id), t("moveCardHint"), n.id, owner && t("inserts") + " · " + name(owner), ...messages.map(diagnosticText)].filter(Boolean).join("\n")}
              onClick={() => {
                if (hasStrip(n.id)) select(n.id);
                showNode(n.id); choose(null); cancel();
              }}
              onKeyDown={e => {
                if (e.altKey || e.ctrlKey || e.metaKey || drag.current) return;
                const direction = cardDirections[e.key];
                if (!direction) return;
                e.preventDefault();
                e.stopPropagation();
                const step = e.shiftKey ? 1 : 16;
                savePosition(n.id, { x: p.x + direction.x * step, y: p.y + direction.y * step });
              }}
              onPointerDown={e => {
                if (e.button !== 0) return;
                drag.current = { id: n.id, pointer: e.pointerId, start: { x: e.clientX, y: e.clientY }, position: p, generation };
                e.currentTarget.setPointerCapture?.(e.pointerId);
              }}>
              <small>{n.number ? SEQUENCER_UI_COPY[language].patch(n.number) + " · " + (n.patch?.always_on ? t("continuous") : t("midiChannelShort") + " " + n.binding?.midiChannel) :
                t(n.id === OUTPUT ? "destination" : n.id === MASTER ? "mixer" : "missing")}</small>
              <strong>{name(n.id)}</strong>
              <span>{owner ? t("inserts") + " · " + name(owner) : n.binding ? n.id.slice(0, 8) : n.id}</span>
              {status && <b aria-label={t("diagnostics")}>!</b>}
            </button>
            {owner && n.binding && <button className="rc-fx-menu" aria-label={t("manageInserts")+" · "+label(n.id)} aria-haspopup="dialog"
              onClick={e => {cancel(); setMenu({mode:"processor", id:n.id, graph, target:menuTarget(e.currentTarget)});}}>⋯</button>}
            {n.inputs.map(socket)}{n.outputs.map(socket)}
            {hasStrip(n.id) && <RoutingInsertList node={n} graph={graph} language={language} running={running} label={label} move={onMove}
              add={el => {cancel(); setMenu({mode:"insert", owner:n.id, index:n.inserts.length, graph, target:menuTarget(el)});}}
              inspect={(el,id) => {cancel(); setMenu({mode:"processor",id,graph,target:menuTarget(el)});}}/>}
          </article>;
        })}
      </>, viewport.plane)}
    </div>
    <div className="rc-status" aria-live="polite">
      {gesture ? <><span>{preview.length ? t("feedbackBadge") : hover && !acceptsSocket(gesture, hover) ? t("mismatch") : t("placeCable")} · {previewMapping || name(gesture.socket.node) + " · " + gesture.socket.ports.join(" / ")}</span><button onClick={cancel}>{t("cancel")} (Esc)</button></> : <span>{running ? t("structural") : t("connectHint")}</span>}
      <span className="rc-legend"><i/> {t("automatic")} <i className="rc-insert-key"/> {t("inserts")}</span>
    </div>
    {validationError && !reportOpen && <div className="rc-validation" role="status">{t("diagnostics")} · {validationError}</div>}
    {selectedCable && routeKind ? <div className="rc-inspect">
      <strong>{detailTitle}</strong><span>{t(selectedCable.implicit ? "automatic" : kindLabel(routeKind))}</span>
      {selectedCable.routes.length > 1 && !selectedCable.implicit && <select aria-label={t("mapping")} value={selectedChannel?.id ?? ""} onChange={e => setChannelId(e.target.value || null)}>
        <option value="">{t("mapping")} · {selectedCable.routes.length}</option>{selectedCable.routes.map(r => <option key={r.id} value={r.id}>{r.sourcePort} → {r.targetPort}</option>)}</select>}
      <small>{inspectedRoutes.map(r => r.sourcePort + " → " + r.targetPort).join(" / ")} · {t(stageLabel(selectedCable.source))} → {t(stageLabel(selectedCable.target))}</small>
      {!selectedCable.implicit && <><button disabled={running} onClick={() => reconnect(selectedCable, "source")}>{t("replaceSource")}</button>
        <button disabled={running} onClick={() => reconnect(selectedCable, "target")}>{t("replaceTarget")}</button>
        <button disabled={running} onClick={() => { onRemove(inspectedRoutes); cancel(); }}>{t("remove")}</button>
        {destinationGroup && destinationGroup.some(r => !selectedCable.routes.includes(r)) &&
          <button disabled={running} onClick={() => { onRemove(destinationGroup); cancel(); }}>{t("removeGroup")} ({destinationGroup.length})</button>}</>}
      {routeKind === "send" && <div className="rc-send-settings"><Gain value={control?.gainDb ?? null} max={6} label={t("gain")} language={language} onChange={gainDb => updateSend({ gainDb })} onFinal={flush} />
        <select aria-label={t("send")} value={control?.tap ?? "post"} onChange={e => { updateSend({ tap: e.target.value as "pre" | "post" }); flush(); }}>
          <option value="pre">{t("pre")}</option><option value="post">{t("post")}</option></select></div>}
    </div> : inspected && <div className="rc-inspect"><strong>{name(inspected.id)}</strong>{nodeActions(inspected.id)}
      {!!incoming?.length && <select aria-label={t("incoming")} value="" onChange={e => { choose(e.target.value); setChannelId(null); cancel(); }}>
        <option value="" disabled>{t("incoming")}</option>
        {incoming.map(c => {
          const first = c.routes[0], send = sends[first.id];
          return <option key={c.key} value={c.implicit ? c.key : first.id}>
            {label(c.source.node)} · {t(c.implicit ? "automatic" : kindLabel(first.kind))} · {c.routes.map(r => r.sourcePort + " → " + r.targetPort).join(", ")}
            {c.source.stage === "raw" && " · " + t("rawStage")}{c.target.stage === "strip" && " · " + t("insertReturn")}
            {first.kind === "send" && ` · ${send?.gainDb ?? "−∞"} dB · ${t(send?.tap === "pre" ? "pre" : "post")}`}
          </option>;
        })}</select>}
      {(faults.get(inspected.id) ?? []).map((d, i) => <small key={i} className="rc-issue" data-status={d.severity}>{diagnosticText(d)}</small>)}</div>}
    {menu && menu.graph === graph && (!running || menu.mode === "processor") && <RoutingJackMenu menu={menu} nodes={model.nodes}
      {...{patches, language, exact, running, label}} close={() => setMenu(null)} dismiss={dismissMenu} change={setMenu} connect={s => activate(s)} insert={onInsert} move={onMove} edit={onEdit} error={onError}
      begin={(s, kind) => {if (kind === "custom") setStages(true); start({mode:"add",socket:s,kind});}}
      addedRoute={id => {choose(id); setChannelId(null); onError(null); cancel(); setMenu(null);}}/>}
  </section>;
}
