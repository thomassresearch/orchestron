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
import { SEQUENCER_UI_COPY } from "./sequencer/sequencerUiCopy";
import { usePerformanceEditorState } from "./sequencer/PerformanceEditorState";
import { useRoutingViewport } from "./useRoutingViewport";
import "./routingCanvas.css";

type Kind = Exclude<AudioRoute["kind"], "insert">;
type Props = {
  bindings: SequencerInstrumentBinding[]; patches: PatchListItem[]; graph: AudioGraph; mixer: MixerState; language: GuiLanguage;
  running: boolean; exact: boolean; setExact: (value: boolean) => void; purpose: Kind; setPurpose: (kind: Kind) => void;
  selected: string; select: (id: string) => void; diagnostics: AudioDiagnostic[]; onlyFeedback: boolean;
  validationError: string | null; focus: AudioDiagnostic | null; onRemove: (rs: AudioRoute[]) => void; onError: (message: string | null) => void;
  nodeActions: (id: string) => ReactNode; diagnosticText: (d: AudioDiagnostic) => string;
  insertPanel: (owner: string, chooseOwner: (id: string) => void) => ReactNode;
};
const kindLabel = (kind: AudioRoute["kind"]) => kind === "insert" ? "inserts" : kind;
const stageLabel = (s: Socket) => s.stage === "raw" ? "rawStage" : s.stage === "input" ? "inputStage" : s.side === "in" ? "insertReturn" : "stripStage";

export function RoutingCanvas({ bindings, patches, graph, mixer, language, exact, setExact, purpose, setPurpose, running, selected, select,
  diagnostics, onlyFeedback, validationError, focus, onRemove, onError, nodeActions, diagnosticText, insertPanel }: Props) {
  const sends = mixer.sends;
  const model = useMemo(() => routingCanvas(bindings, patches, graph, sends, exact, purpose === "custom"), [bindings, patches, graph, sends, exact, purpose]);
  const [positions, setPositions] = usePerformanceEditorState<Record<string, Point>>("mixer", "routingPositions", {});
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
  const [pending, setGesture] = useState<{ gesture: CableGesture; model: typeof model } | null>(null);
  const gesture = pending?.model === model && !running ? pending.gesture : null;
  const [hover, setHover] = useState<Socket | null>(null);
  const [selection, choose] = usePerformanceEditorState<string | null>("mixer", "selectedCable", null);
  const [nodeId, showNode] = useState<string | null>(null);
  const [insertsOpen, setInsertsOpen] = usePerformanceEditorState("mixer", "routingInsertsOpen", false);
  const [chosenOwner, setChosenOwner] = usePerformanceEditorState<{ selected: string; owner: string } | null>("mixer", "routingInsertOwner", null);
  const insertPanelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const hasStrip = (id: string) => id === MASTER || !!model.nodes.get(id)?.binding;
  const selectedOwner = graph.insertOwners[selected] ?? selected;
  const owner = chosenOwner?.selected === selected && hasStrip(chosenOwner.owner) ? chosenOwner.owner : hasStrip(selectedOwner) ? selectedOwner : "";
  const [channelId, setChannelId] = useState<string | null>(null);
  const drag = useRef<{ id: string; pointer: number; start: Point; position: Point } | null>(null);
  const wire = useRef<SVGPathElement>(null);
  const t = audioCopy(language);
  const name = (id: string) => id === OUTPUT ? t("audioOutput") : id === MASTER ? t("master") : model.nodes.get(id)?.patch?.name ?? id;
  const at = (s: Socket) => socketPoint(model.nodes.get(s.node)!, s, positions[s.node]);
  const selectedCable = model.cables.find(c => c.implicit ? c.key === selection : c.routes.some(r => r.id === selection));
  const inspected = model.nodes.get(nodeId && !model.nodes.get(nodeId)?.binding && nodeId !== MASTER ? nodeId : selected);
  const selectedChannel = selectedCable?.routes.find(r => r.id && r.id === channelId);
  const inspectedRoutes = selectedChannel ? [selectedChannel] : selectedCable?.routes ?? [];
  const cancel = () => { setGesture(null); setHover(null); };
  const exactReconnect = useRef<{ id: string; mode: "source" | "target"; graph: AudioGraph } | null>(null);
  const previousSelection = useRef(selected);
  useEffect(() => {
    if (selected === previousSelection.current) return;
    previousSelection.current = selected;
    showNode(null); choose(null); setChannelId(null);
  }, [selected, choose]);
  useEffect(() => { cancel(); }, [graph, bindings, patches, running, exact, purpose]);
  useEffect(() => {
    const request = exactReconnect.current;
    if (!request) return;
    exactReconnect.current = null;
    if (!exact || running || request.graph !== graph) return;
    const cable = model.cables.find(c => c.routes.some(r => r.id === request.id));
    if (!cable) return;
    const socket = request.mode === "source" ? cable.target : cable.source;
    const routes = cable.routes.filter(r => r.id === request.id);
    setGesture({ model, gesture: { mode: request.mode, routes, socket } });
    choose(request.id);
  }, [exact, running, graph, model, choose]);
  useEffect(() => {
    if (!gesture) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("blur", cancel); };
  }, [gesture]);

  const centerRef = useRef(viewport.center);
  centerRef.current = viewport.center;
  useEffect(() => {
    if (!focus) return;
    const id = focus.instanceId ?? focus.instanceIds?.[0];
    const node = id && model.nodes.get(id);
    if (node) { showNode(node.id); centerRef.current(node); }
    choose(focus.routeId ?? null);
    setChannelId(focus.routeId ?? null);
    // A diagnostic click moves the viewport once, including when the same entry is clicked again.
  }, [focus]);

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
  function start(g: CableGesture) { setGesture({ gesture: g, model }); setHover(null); onError(null); }
  function activate(s: Socket) {
    if (running || s.missing) return;
    if (gesture && acceptsSocket(gesture, s)) {
      const state = useAppStore.getState();
      if (state.activeSessionState === "running" || state.audioGraph !== graph) { cancel(); return; }
      const changes = connectSockets(gesture, s);
      const next = withRoutingEdit(graph, changes, gesture.mode !== "add");
      if (next.routes.length > 1024) { onError(t("routeLimit")); cancel(); return; }
      state.setAudioGraph(next, gesture.mode === "add" && gesture.kind === "send" ? changes.map(r => r.id) : []);
      choose(changes[0].id); setChannelId(null); onError(null); cancel();
    } else if (s.side === "out" && (purpose === "custom" || s.stage === "strip") && (!gesture || gesture.mode === "add")) {
      if (graph.routes.length + s.ports.length > 1024) { onError(t("routeLimit")); cancel(); return; }
      select(s.node); showNode(s.node); start({ mode: "add", socket: s, kind: purpose });
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
  function inspect(c: Cable) {
    choose(c.implicit ? c.key : c.routes[0].id); setChannelId(null); cancel();
  }
  function move(e: PointerEvent) {
    if (drag.current && e.pointerId === drag.current.pointer) {
      const { id, start, position } = drag.current;
      const k = viewport.view.current!.area.transform.k;
      setPositions(p => ({ ...p, [id]: { x: position.x + (e.clientX - start.x) / k, y: position.y + (e.clientY - start.y) / k } }));
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
      onClick={() => activate(s)} onPointerEnter={() => { if (gesture && gesture.socket !== s) setHover(s); }} onPointerLeave={() => setHover(null)}
      onFocus={() => { if (gesture) setHover(s); }} onBlur={() => setHover(null)}>{label}</button>;
  }
  const routeKind = selectedCable?.routes[0].kind;
  const detailTitle = selectedCable && name(selectedCable.source.node) + " → " + name(selectedCable.target.node);
  const control = inspectedRoutes[0] && sends[inspectedRoutes[0].id];
  const previewMapping = candidate.length ? name(candidate[0].sourceId) + " " + candidate.map(r => r.sourcePort).join(" / ") +
    " → " + name(candidate[0].targetId) + " " + candidate.map(r => r.targetPort).join(" / ") : "";
  const updateSend = (v: Partial<MixerState["sends"][string]>) => useAppStore.getState().setMixerSend(inspectedRoutes.map(r => r.id), v);
  const flush = () => { void useAppStore.getState().flushMixer().catch(() => undefined); };

  return <section className="routing-canvas">
    <div className="rc-tools">
      <div className="rc-kinds" role="group" aria-label={t("route")}>{(["main", "send", "custom"] as const).map(kind =>
        <button key={kind} type="button" data-kind={kind} aria-pressed={purpose === kind} disabled={running} onClick={() => setPurpose(kind)}>{t(kind)}</button>)}</div>
      <button className="rc-insert-toggle" type="button" aria-expanded={insertsOpen} aria-controls={insertPanelId}
        onClick={() => { cancel(); setInsertsOpen(!insertsOpen); }}>{t("inserts")}</button>
      <label><input type="checkbox" checked={exact} onChange={e => setExact(e.target.checked)} /> {t("exactPorts")}</label>
      <div className="rc-navigation"><button type="button" aria-label={t("zoomOut")} onClick={() => viewport.zoom(.8)}>−</button>
        <button type="button" aria-label={t("zoomIn")} onClick={() => viewport.zoom(1.25)}>+</button>
        <button type="button" onClick={() => viewport.fit()}>{t("fit")}</button></div>
    </div>
    <div id={insertPanelId} ref={panelRef} hidden={!insertsOpen}>
      {insertsOpen && insertPanel(owner, id => setChosenOwner({ selected, owner: id }))}
    </div>
    <div className="rc-viewport" ref={viewport.host} aria-label={t("diagram")} onPointerMove={move}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; cancel(); }}>
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
            onClick={() => inspect(c)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inspect(c); } }}>
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
            <button type="button" className="rc-title" title={[name(n.id), n.id, owner && t("inserts") + " · " + name(owner), ...messages.map(diagnosticText)].filter(Boolean).join("\n")}
              onClick={() => {
                if (hasStrip(n.id)) { select(n.id); setChosenOwner(null); }
                showNode(n.id); choose(null); cancel();
              }}
              onPointerDown={e => {
                if (e.button !== 0) return;
                drag.current = { id: n.id, pointer: e.pointerId, start: { x: e.clientX, y: e.clientY }, position: p };
                e.currentTarget.setPointerCapture?.(e.pointerId);
              }}>
              <small>{n.number ? SEQUENCER_UI_COPY[language].patch(n.number) + " · " + (n.patch?.always_on ? t("continuous") : t("midiChannelShort") + " " + n.binding?.midiChannel) :
                t(n.id === OUTPUT ? "destination" : n.id === MASTER ? "mixer" : "missing")}</small>
              <strong>{name(n.id)}</strong>
              <span>{owner ? t("inserts") + " · " + name(owner) : n.binding ? n.id.slice(0, 8) : n.id}</span>
              {status && <b aria-label={t("diagnostics")}>!</b>}
            </button>
            {n.inputs.map(socket)}{n.outputs.map(socket)}
          </article>;
        })}
      </>, viewport.plane)}
    </div>
    <div className="rc-status" aria-live="polite">
      {gesture ? <><span>{preview.length ? t("feedbackBadge") : hover && !acceptsSocket(gesture, hover) ? t("mismatch") : t("placeCable")} · {previewMapping || name(gesture.socket.node) + " · " + gesture.socket.ports.join(" / ")}</span><button onClick={cancel}>{t("cancel")} (Esc)</button></> : <span>{running ? t("structural") : t("connectHint")}</span>}
      <span className="rc-legend"><i/> {t("automatic")} <i className="rc-insert-key"/> {t("inserts")}</span>
    </div>
    {validationError && !diagnostics.some(d => d.severity === "error") && <div className="rc-validation" role="status">{t("diagnostics")} · {validationError}</div>}
    {selectedCable && routeKind ? <div className="rc-inspect">
      <strong>{detailTitle}</strong><span>{t(selectedCable.implicit ? "automatic" : kindLabel(routeKind))}</span>
      {selectedCable.routes.length > 1 && !selectedCable.implicit && <select aria-label={t("mapping")} value={selectedChannel?.id ?? ""} onChange={e => setChannelId(e.target.value || null)}>
        <option value="">{t("mapping")} · {selectedCable.routes.length}</option>{selectedCable.routes.map(r => <option key={r.id} value={r.id}>{r.sourcePort} → {r.targetPort}</option>)}</select>}
      <small>{inspectedRoutes.map(r => r.sourcePort + " → " + r.targetPort).join(" / ")} · {t(stageLabel(selectedCable.source))} → {t(stageLabel(selectedCable.target))}</small>
      {!selectedCable.implicit && <><button disabled={running} onClick={() => reconnect(selectedCable, "source")}>{t("replaceSource")}</button>
        <button disabled={running} onClick={() => reconnect(selectedCable, "target")}>{t("replaceTarget")}</button>
        <button disabled={running} onClick={() => { onRemove(inspectedRoutes); cancel(); }}>{t("remove")}</button></>}
      {routeKind === "send" && <div className="rc-send-settings"><Gain value={control?.gainDb ?? null} max={6} label={t("gain")} language={language} onChange={gainDb => updateSend({ gainDb })} onFinal={flush} />
        <select aria-label={t("send")} value={control?.tap ?? "post"} onChange={e => { updateSend({ tap: e.target.value as "pre" | "post" }); flush(); }}>
          <option value="pre">{t("pre")}</option><option value="post">{t("post")}</option></select></div>}
    </div> : inspected && <div className="rc-inspect"><strong>{name(inspected.id)}</strong>{nodeActions(inspected.id)}
      {hasStrip(inspected.id) && <button onClick={() => {
        setChosenOwner({ selected, owner: graph.insertOwners[inspected.id] ?? inspected.id }); setInsertsOpen(true); cancel();
        requestAnimationFrame(() => panelRef.current?.querySelector("select")?.focus());
      }}>{t("manageInserts")}</button>}
      {(faults.get(inspected.id) ?? []).map((d, i) => <small key={i} className="rc-issue" data-status={d.severity}>{diagnosticText(d)}</small>)}</div>}
  </section>;
}
