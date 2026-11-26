import { sameArrangement, useArrangementEdits, workingSequencer } from "../../lib/clipArranger/editSession";
import { clipLoopTarget, type ClipSelection } from "../../lib/clipArranger/loopTarget";
import type { StructureFocus, StructureSelection } from "../../lib/clipArranger/structure";
import { useRackSelection } from "./useRackSelection";
import { arrangeCopy } from "../clipArranger/arrangeCopy";
import { InstrumentControls } from "./InstrumentControls";
import { useArrangeControlRoutes } from "./useArrangeControlRoutes";
import { absoluteTransportStep } from "../../lib/arrangerTransport";
import { sequencerTransportSubunitsPerStep } from "../../lib/sequencer";
import { hasChangedClipDrafts } from "../../lib/clipArranger/draftResolution";
import { useStructureDraft } from "../../lib/clipArranger/structureStore";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useStore } from "zustand";
import type { GuiLanguage, HelpDocId } from "../../types";
import { HelpIconButton } from "../HelpIconButton";
import { useAppStore } from "../../store/useAppStore";
import { clipCopy } from "../clipArranger/copy";
import { QUARTER_TICKS } from "../../lib/clipArranger/model";
import { PositionInput } from "../clipArranger/PositionInput";
import { mixCopy } from "./mixCopy";
import { EngineStatusLine } from "../EngineStatusLine";
import { clampDock, DockDivider, maxDockHeight, MIN_DOCK, DIVIDER_HEIGHT } from "./DockDivider";
import { editorKey, PerformViewContext, RetainedScroll, usePerformanceEditorState, usePerformanceEditorStore, type PerformView, type PerformViewLayout } from "./PerformanceEditorState";
import { shellCopy, WorkspacePanels } from "./WorkspacePanels";
import { CompactRack } from "./CompactRack";
import { PerformNavigation, survivingClipKey, type MixSurface, type ViewNavigation } from "./PerformWorkspace";
import type { SequencerPageTransportActions } from "./sequencerPageContracts";
import "./workspace.css";

function SongPositionControls({ language, onSeek, onTempo }: {
  language: GuiLanguage; onSeek: SequencerPageTransportActions["onSequencerArrangerLoopSelectionChange"]; onTempo: (bpm: number) => void;
}) {
  const c = clipCopy(language), store = usePerformanceEditorStore();
  const selected = useStore(store, s => s.entries[editorKey("arranger", "clipSelection", "arrange")]?.value as ClipSelection | undefined);
  const focus = useStore(store, s => s.entries[editorKey("arranger", "structureFocus", "arrange")]?.value as StructureFocus | undefined);
  const selection = useStore(store, s => s.entries[editorKey("arranger", "structureSelection", "arrange")]?.value as StructureSelection | undefined);
  const authored = useAppStore(s => s.sequencer), edits = useArrangementEdits(s => s.session);
  const sequencer = useMemo(() => workingSequencer(authored, edits), [authored, edits]);
  const target = useMemo(() => clipLoopTarget(sequencer, selected, focus, selection), [sequencer, selected, focus, selection]);
  const range = sequencer.arrangerLoopSelection;
  const songLoop = useAppStore(s => s.sequencer.arrangerSongLoopEnabled);
  const ticksPerStep = sequencerTransportSubunitsPerStep();
  const position = useAppStore(({ sequencerRuntime: runtime }) => runtime.arrangerTransportSubunit ??
    absoluteTransportStep(runtime.playhead, runtime.cycle, runtime.stepCount) * ticksPerStep);
  const beatsPerBar = useAppStore(s => s.sequencer.timing.meterNumerator);
  const beat = Math.floor(position / QUARTER_TICKS);
  const bpm = useAppStore(s => s.sequencer.timing.tempoBPM);
  return <><button type="button" aria-pressed={target ? !!range : !!songLoop} title={target ? c[target.label] : c.loopSong}
    onClick={() => {
      if (!target) useAppStore.getState().setSequencerArrangerSongLoopEnabled(!songLoop);
      else onSeek(range ? null : target.range);
    }}>{c.loop}</button>
    <span className="ws-song-position">
      <span className="ws-bars" title={arrangeCopy(language).barBeat} aria-label={arrangeCopy(language).barBeat}>{Math.floor(beat / beatsPerBar) + 1}.{beat % beatsPerBar + 1}</span>
      <label>{c.position} <PositionInput className="ws-number" beats={position / QUARTER_TICKS} onSeek={step => onSeek(range, step)} /></label>
      <label>BPM <input className="ws-number" type="number" min={30} max={300} value={bpm} onChange={e => onTempo(Number(e.target.value))} /></label>
    </span></>;
}

type Props = {
  view: PerformView; navigate: ViewNavigation; language: GuiLanguage; children: ReactNode; project: ReactNode; save: ReactNode; engine: ReactNode;
  transport: ReactNode; keyboard: ReactNode; name: string; midi: string; session: string;
  onSeek: SequencerPageTransportActions["onSequencerArrangerLoopSelectionChange"]; onTempo: (bpm: number) => void;
  diagnostics?: import("../../audio/browserClockWorkerProtocol").BrowserClockWorkerDiagnostics | null;
  error: string | null; onHelpRequest?: (id: HelpDocId) => void;
};

export default function WorkspaceShell({ diagnostics, view, navigate, language, children, project, save, engine, transport, keyboard, name, midi, session, error, onHelpRequest, onSeek, onTempo }: Props) {
  const c = shellCopy[language], clip = clipCopy(language);
  const [layout, setLayout] = usePerformanceEditorState<PerformViewLayout>("page", "layout", {});
  const editorStore = usePerformanceEditorStore();
  const keyboardOpen = useStore(editorStore, s => s.keyboardOpen);
  const keyboardId = useId();
  const [overviewClipKey, setOverviewClipKey] = useState<string | null>(null);
  const [rackMenuView, setRackMenuView] = useState<PerformView | null>(null);
  const rackTrigger = useRef<HTMLButtonElement>(null), rackMenu = useRef<HTMLDivElement>(null);
  const { primary: mixSelection, ids } = useRackSelection();
  const [mixSurface] = usePerformanceEditorState<MixSurface>("mixer", "surface", "mixer");
  const [remembered, remember] = usePerformanceEditorState<string | null>("page", "closedEditor", null);
  const clipKey = useAppStore(s => s.clipEditingKey);
  const staged = useArrangementEdits(s => s.session);
  const stagedChanges = useMemo(() => !!staged && !sameArrangement(staged.basis, staged.model), [staged?.basis, staged?.model]);
  const committed = useAppStore(s => s.sequencer.clipArrangement);
  const model = staged?.model ?? committed;
  const [controlsTarget, setControlsTarget] = usePerformanceEditorState<{ laneId: string } | "rack" | null>("arranger", "controlsTarget", null);
  const routes = useArrangeControlRoutes(view === "arrange");
  const controlsLaneId = typeof controlsTarget === "object" ? controlsTarget?.laneId : undefined;
  const controlLane = controlsLaneId ? routes.get(controlsLaneId) : undefined;
  const controlsIds = view !== "arrange" ? null : controlsTarget === "rack" && ids.length ? ids : controlLane?.enabled ? controlLane.ids : null;
  useEffect(() => {
    if (view === "arrange" && controlsTarget && !controlsIds) setControlsTarget(null);
  }, [view, controlsTarget, controlsIds, setControlsTarget]);
  const [selected] = usePerformanceEditorState<{ clipId?: string; laneId: string } | null>("arranger", "clipSelection", null);
  const drafts = useAppStore(s => s.clipDrafts);
  const musicalChanges = useMemo(() => hasChangedClipDrafts(model, drafts), [model, drafts]);
  const structuralChanges = useStructureDraft(s => !!s.draft?.cursor);
  const appError = useAppStore(s => s.error || s.mixerSyncError);
  const issue = error || appError;
  const editorDock = view === "arrange" && model ? clipKey ? "editor" : null : layout.dock;
  const dock = controlsIds ? "instrument" : editorDock;
  const patternDock = dock === "editor" && view !== "mix";
  const detailOwner = view === "mix" && mixSelection && (dock === "samples" || ids.length === 1) ? `binding:${mixSelection}` as const : "page";
  const copy = mixCopy(language);
  const dockLabel = dock === "instrument" && controlLane ? `${controlLane.name} · ${copy("instrument")}`
    : dock === "samples" || dock === "instrument" ? copy(dock) : c.editor;
  const work = useRef<HTMLDivElement>(null), main = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, mainWidth: 0, mainHeight: 0 });
  const [coarse, setCoarse] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    const area = work.current!, column = main.current!;
    const measure = () => {
      const next = { width: area.clientWidth, height: area.clientHeight, mainWidth: column.clientWidth, mainHeight: column.clientHeight };
      setSize(s => s.width === next.width && s.height === next.height && s.mainWidth === next.mainWidth && s.mainHeight === next.mainHeight ? s : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area); observer.observe(column);
    return () => observer.disconnect();
  }, []);
  // Reserve a ruler, a complete track and the arrangement tools, which wrap beside the Inspector.
  // Use the potential sidebar width so opening it cannot switch modes halfway through the action.
  const sidebarWidth = Math.max(230, Math.min(360, size.width * .23));
  const overviewMinimum = view === "arrange" && model ? (size.width - sidebarWidth < 780 ? 312 : 245) : view === "mix" ? 255 : 165;
  const grip = coarse ? 24 : DIVIDER_HEIGHT;
  const narrow = size.width < 700 || window.innerHeight < 600 || size.height < MIN_DOCK + overviewMinimum + grip;
  const floatingRack = (keyboardOpen || !!controlsIds || view === "mix" && !!dock) && window.innerHeight <= 460;
  const rackOpen = floatingRack ? rackMenuView === view : layout.compactRackOpen ?? view === "mix";
  useEffect(() => { setRackMenuView(null); }, [view, floatingRack]);
  const inspector = narrow ? !!layout.drawerOpen : layout.inspectorOpen ?? view === "arrange";
  // A scrollable control card and one timeline lane can share a short window.
  const compactControls = !!controlsIds && size.mainHeight < MIN_DOCK + overviewMinimum + grip;
  const dockMinimum = compactControls ? 88 : MIN_DOCK;
  const trackMinimum = compactControls ? 84 : overviewMinimum;
  const currentDraft = clipKey ? drafts[clipKey] : undefined;
  const scopeOnly = view === "arrange" && !controlsIds && currentDraft?.definition.kind === "pattern" &&
    currentDraft.editIntent?.scope === null && !layout.dockExpanded && size.mainHeight >= 260;
  // Leave room for the toolbar, beat ruler and a complete melodic step in the initial split.
  const patternHeight = 300;
  const splitMinimum = patternDock && layout.preferredDockHeight === undefined ? patternHeight : dockMinimum;
  const shortSplit = patternDock && size.mainHeight < splitMinimum + trackMinimum + grip;
  const single = !!dock && !scopeOnly && (controlsIds ? size.mainHeight < dockMinimum + trackMinimum + grip : narrow || shortSplit || !!layout.dockExpanded);
  const showOverview = !controlsIds && single && view === "arrange" && !!clipKey && overviewClipKey === clipKey;
  const compactArrangeEditor = view === "arrange" && single && !showOverview && window.innerHeight <= 460;
  const compactLauncher = view === "live" && keyboardOpen && narrow;
  const showLauncherInEditor = compactLauncher && single && size.mainHeight >= MIN_DOCK + 128;
  useEffect(() => { setOverviewClipKey(null); }, [clipKey, view]);
  useLayoutEffect(() => {
    const overview = main.current?.querySelector(".ws-overview");
    if (single && !showOverview && (document.activeElement === document.body || overview?.contains(document.activeElement))) back.current?.focus({ preventScroll: true });
  }, [single, showOverview, compactArrangeEditor, view]);
  const max = maxDockHeight(size.mainHeight, trackMinimum, grip, dockMinimum);
  const height = clampDock(layout.preferredDockHeight ?? (patternDock ? patternHeight : 260), max, dockMinimum);
  useLayoutEffect(() => {
    if (!compactControls || single) return;
    const overview = main.current?.querySelector<HTMLElement>(".ws-overview");
    const id = controlsLaneId ?? selected?.laneId;
    const button = overview?.querySelector<HTMLElement>(id ? `[data-lane-controllers="${CSS.escape(id)}"]` : "[data-lane-controllers]");
    if (!overview || !button) return;
    const previous = overview.scrollTop;
    button.scrollIntoView({ block: "nearest", inline: "nearest" });
    return () => { overview.scrollTop = previous; };
  }, [compactControls, single, controlsLaneId, selected?.laneId]);
  const [launcherHost, setLauncherHost] = useState<HTMLDivElement | null>(null);
  const [mixControls, setMixControls] = useState<HTMLDivElement | null>(null);
  const [editorHost, setEditorHost] = useState<HTMLDivElement | null>(null);
  const [commandHost, setCommandHost] = useState<HTMLSpanElement | null>(null);
  const [inspectorHost, setInspectorHost] = useState<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), drawerClose = useRef<HTMLButtonElement>(null);
  const focusDrawer = useRef(false);
  const dockId = useId(), inspectorId = useId();
  const projectMenu = useRef<HTMLDetailsElement>(null);
  const errorDetails = useRef<HTMLDetailsElement>(null);
  const change = (patch: PerformViewLayout) => setLayout(previous => ({ ...previous, ...patch }));
  const openInstrumentControls = (bindingIds: string[]) => {
    setRackMenuView(null);
    if (view === "arrange") { setControlsTarget("rack"); change({ drawerOpen: false }); }
    else if (view === "mix") change({ dock: "instrument", drawerOpen: false });
    else navigate("mix", { surface: "mixer", bindingIds, dock: "instrument" });
  };
  const closeInspector = () => { change(narrow ? { drawerOpen: false } : { inspectorOpen: false }); trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (focusDrawer.current && narrow && inspector) drawerClose.current?.focus();
    focusDrawer.current = false;
  }, [narrow, inspector]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (errorDetails.current?.open) { errorDetails.current.open = false; errorDetails.current.querySelector("summary")?.focus(); }
      else if (projectMenu.current?.open) { projectMenu.current.open = false; projectMenu.current.querySelector("summary")?.focus(); }
      else if (floatingRack && rackOpen) { setRackMenuView(null); rackTrigger.current?.focus(); }
      else if (narrow && inspector) { setLayout(s => ({ ...s, drawerOpen: false })); trigger.current?.focus(); }
    };
    const outside = (e: PointerEvent) => {
      if (errorDetails.current?.open && !errorDetails.current.contains(e.target as Node)) errorDetails.current.open = false;
      if (projectMenu.current?.open && !projectMenu.current.contains(e.target as Node)) projectMenu.current.open = false;
      if (floatingRack && rackOpen && !(e.target as Element).closest("[data-compact-rack-menu]") && !rackMenu.current?.contains(e.target as Node) && !rackTrigger.current?.contains(e.target as Node)) setRackMenuView(null);
    };
    document.addEventListener("keydown", key); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", outside); };
  }, [narrow, inspector, setLayout, floatingRack, rackOpen]);
  const patternClose = useRef<((finish: () => void) => void) | null>(null);
  const closeDock = () => {
    if (controlsIds) { setControlsTarget(null); return; }
    const finish = () => {
      if (clipKey && view === "arrange") { remember(clipKey); useAppStore.setState({ clipEditingKey: null }); }
      change({ dock: null, dockExpanded: false });
    };
    if (clipKey && view === "arrange" && patternClose.current) patternClose.current(finish);
    else finish();
  };
  const returnToOverview = () => {
    if (controlsIds) { setControlsTarget(null); setOverviewClipKey(null); }
    else if (single && keyboardOpen && clipKey && view === "arrange") setOverviewClipKey(clipKey);
    else closeDock();
    requestAnimationFrame(() => {
      const frame = work.current?.closest(".ws-shell");
      let source = commandHost?.querySelector("button");
      if (controlsIds && !editorDock) source = controlsLaneId
        ? frame?.querySelector<HTMLButtonElement>(`[data-lane-controllers="${CSS.escape(controlsLaneId)}"]`) : rackTrigger.current;
      if (view === "live") source = frame?.querySelector<HTMLButtonElement>("[data-selected] [data-pad-editor-toggle]");
      if (view === "mix") source = frame?.querySelector<HTMLButtonElement>(`.ws-mix-tools [data-mix-detail="${dock}"]`);
      (source ?? trigger.current)?.focus({ preventScroll: true });
    });
  };
  const backLabel = controlsIds && editorDock ? copy("backToEditor") : single ? c.back : c.close;
  const paneActions = <>
    {!narrow && !shortSplit && !controlsIds && <button aria-expanded={!!layout.dockExpanded} onClick={() => change({ dockExpanded: !layout.dockExpanded })}>{layout.dockExpanded ? c.restore : c.expand}</button>}
    <button ref={back} onClick={returnToOverview}>{backLabel}</button>
  </>;
  const context = { slots: { mixControls, launcher: launcherHost, editor: editorHost, inspector: inspectorHost, editorCommand: commandHost, dialogs: document.body },
    patternClose, paneActions: patternDock && !compactArrangeEditor ? paneActions : null,
    laneControllers: (id: string) => {
      const route = routes.get(id);
      if (!route) return null;
      const pressed = !!controlsIds && controlsLaneId === id;
      return <button type="button" data-lane-controllers={id} aria-pressed={pressed} aria-controls={dockId}
        className="ws-lane-controllers" disabled={!route.enabled}
        title={route.enabled ? copy("openControls") : route.ids.length ? copy("noControls") : copy("noDestination")}
        onClick={() => { setControlsTarget(pressed ? null : { laneId: id }); setOverviewClipKey(null); change({ drawerOpen: false }); }}>
        {copy("controllers")}
      </button>;
    },
    getRememberedTarget: () => {
      const target = remembered && survivingClipKey(remembered) ? useAppStore.getState().clipDrafts[remembered]?.target : undefined;
      return target?.laneId === selected?.laneId && target?.clipId === selected?.clipId ? target : undefined;
    },
    singlePane: single, editorHidden: showOverview || !!controlsIds,
    revealEditor: () => { setControlsTarget(null); setOverviewClipKey(null); }, closeDock };
  return <WorkspacePanels.Provider value={context}><section className="ws-shell" data-keys-open={keyboardOpen || undefined}>
    <header className="ws-head">
      <div className="ws-control-band">
        <div className="ws-project-controls">
          <details className="ws-project" ref={projectMenu}><summary>{c.project}</summary>
            <div className="ws-project-menu" onClick={e => { if ((e.target as Element).closest("button") && projectMenu.current) {
              projectMenu.current.open = false; projectMenu.current.querySelector("summary")?.focus();
            } }}
              onChange={e => { if (e.target instanceof HTMLSelectElement && projectMenu.current) projectMenu.current.open = false; }}>{project}</div></details>
          <strong className="ws-title" title={name}>{name}</strong>{save}
        </div>
        <div className="ws-transport-row"><div className="ws-transport" role="group" aria-label={c.transport}>{transport}<SongPositionControls language={language} onSeek={onSeek} onTempo={onTempo} /></div>
          {compactArrangeEditor && <button className="ws-back" ref={back} onClick={returnToOverview}>{backLabel}</button>}
        </div>
        <div className="ws-commandbar">
          <span className="ws-editor-command" ref={setCommandHost} />
          <button data-keyboard-toggle aria-controls={keyboardId} aria-pressed={keyboardOpen}
            onClick={() => editorStore.setState(s => ({ keyboardOpen: !s.keyboardOpen }))}>{c.keyboard}</button>
          <button ref={rackTrigger} aria-expanded={rackOpen} onClick={() => {
            if (floatingRack) setRackMenuView(rackOpen ? null : view);
            else change({ compactRackOpen: !rackOpen });
          }}>{mixCopy(language)("compact")}</button>
          <button ref={trigger} aria-expanded={inspector} aria-controls={inspectorId} onClick={() => {
            if (inspector) closeInspector();
            else { focusDrawer.current = narrow; change(narrow ? { drawerOpen: true } : { inspectorOpen: true }); }
          }}>{c.inspector}</button>{engine}
          {onHelpRequest && <HelpIconButton guiLanguage={language} topic={`${c.project} / ${c.transport}`}
            className="ws-help" onClick={() => onHelpRequest("perform_project_transport")} />}
        </div>
      </div>
      <PerformNavigation view={view} language={language} navigate={navigate} onHelpRequest={onHelpRequest} />
      {rackOpen && <div ref={rackMenu} className={floatingRack ? "ws-rack-menu" : undefined}><CompactRack language={language}
        onOpenControls={view === "mix" && mixSurface === "rack" ? undefined : openInstrumentControls} onNavigate={view === "mix" ? undefined : navigate} /></div>}
    </header>
    <div className="ws-work" ref={work} data-sidebar={!narrow && inspector || undefined}>
      <div className="ws-panes" ref={main} style={{ "--dock-height": height + "px" } as CSSProperties} data-split={dock && !single || undefined} data-scope-only={scopeOnly || undefined} data-compact-controllers={compactControls && !single || undefined}>
        <RetainedScroll key={view} owner="page" field="overviewScroll" className="ws-overview" data-compact-launch={compactLauncher || undefined} hidden={single && !showOverview} role="region" aria-label={c.overview}>
          {compactLauncher && !single && <div className="ws-compact-launch" ref={setLauncherHost} />}{children}
        </RetainedScroll>
        {dock && !single && !scopeOnly && <DockDivider key={view + dock} label={c.divider} controls={dockId} height={height} max={max} min={dockMinimum} layoutWidth={size.mainWidth} layoutHeight={size.mainHeight} onCommit={preferredDockHeight => change({ preferredDockHeight })} />}
        {dock && <section id={dockId} className="ws-dock" hidden={showOverview} data-compact-launch={showLauncherInEditor || undefined} data-inline-back={compactArrangeEditor || undefined} data-pattern-dock={patternDock || undefined} aria-label={dockLabel}>
          {!compactArrangeEditor && !patternDock && <header><h2>{dockLabel}</h2>
            {paneActions}</header>}
          {showLauncherInEditor && <div className="ws-compact-launch" ref={setLauncherHost} />}
          {view === "mix" && <div className="ws-dock-mix-controls" ref={setMixControls} />}
          {editorDock === "editor" && view !== "mix" ? <div className="ws-clip-editor-host" hidden={!!controlsIds} ref={setEditorHost} /> : editorDock && <RetainedScroll key={view + editorDock + detailOwner} hidden={!!controlsIds} className="ws-dock-scroll" owner={detailOwner} field={editorDock + "Scroll"}>
            <div ref={setEditorHost} />
          </RetainedScroll>}
          {controlsIds && <RetainedScroll key={controlsLaneId ?? "rackControls"} owner={controlsLaneId ? `device:${controlsLaneId}` : "rack"} field="instrumentControlsScroll" className="ws-dock-scroll">
            <InstrumentControls ids={controlsIds} language={language} />
          </RetainedScroll>}
        </section>}
      </div>
      {inspector && <aside id={inspectorId} aria-label={c.inspector} className="ws-inspector" data-drawer={narrow || undefined}>
        <header><h2>{c.inspector}</h2><button ref={drawerClose} aria-label={c.close + " · " + c.inspector} onClick={closeInspector}>×</button></header>
        <RetainedScroll owner="page" field={narrow ? "drawerScroll" : "inspectorScroll"} className="ws-inspector-scroll" key={view + String(narrow)}>
          {view === "arrange" && model && !selected && <p>{clip.select}</p>}<div ref={setInspectorHost} />
        </RetainedScroll>
      </aside>}
    </div>
    {keyboardOpen && <section id={keyboardId} className="ws-keyboard" aria-label={c.keyboard}>
      <PerformViewContext.Provider value={null}>{keyboard}</PerformViewContext.Provider>
    </section>}
    <footer className="ws-status" aria-label={c.status}><span className="ws-session">{session}</span><span>{midi}</span>
      {(musicalChanges || structuralChanges || stagedChanges) && <span className="text-amber-200">{clip.unsaved}</span>}
      <EngineStatusLine embedded diagnostics={diagnostics} />
      {issue && <details className="ws-error" ref={errorDetails}>
        <summary title={c.errorDetails}><span role="alert">{issue}</span></summary>
        <div className="ws-error-details" role="region" aria-label={c.errorDetails} tabIndex={0}>{issue}</div>
      </details>}
    </footer>
  </section></WorkspacePanels.Provider>;
}
