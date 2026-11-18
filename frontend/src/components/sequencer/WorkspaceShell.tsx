import { arrangeCopy } from "../clipArranger/arrangeCopy";
import { ArrangeTrackRouting } from "./ArrangeTrackRouting";
import { absoluteTransportStep } from "../../lib/arrangerTransport";
import { sequencerTransportSubunitsPerStep } from "../../lib/sequencer";
import { hasChangedClipDrafts } from "../../lib/clipArranger/draftResolution";
import { useStructureDraft } from "../../lib/clipArranger/structureStore";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useStore } from "zustand";
import type { GuiLanguage } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { clipCopy } from "../clipArranger/copy";
import { QUARTER_TICKS } from "../../lib/clipArranger/model";
import { PositionInput } from "../clipArranger/PositionInput";
import { sourceKeys } from "../../lib/clipArranger/migration";
import { audioCopy } from "../../lib/audioCopy";
import { EngineStatusLine } from "../EngineStatusLine";
import { clampDock, DockDivider, maxDockHeight, MIN_DOCK, DIVIDER_HEIGHT } from "./DockDivider";
import { editorKey, RetainedScroll, usePerformanceEditorState, usePerformanceEditorStore, type PerformView, type PerformViewLayout } from "./PerformanceEditorState";
import { shellCopy, WorkspacePanels } from "./WorkspacePanels";
import { survivingClipKey } from "./PerformWorkspace";
import type { SequencerPageTransportActions } from "./sequencerPageContracts";
import "./workspace.css";

function SongPositionControls({ language, onSeek, onTempo }: {
  language: GuiLanguage; onSeek: SequencerPageTransportActions["onSequencerArrangerLoopSelectionChange"]; onTempo: (bpm: number) => void;
}) {
  const c = clipCopy(language), store = usePerformanceEditorStore();
  const selected = useStore(store, s => s.entries[editorKey("arranger", "clipSelection", "arrange")]?.value as { laneId: string; clipId?: string } | undefined);
  const model = useAppStore(s => s.sequencer.clipArrangement);
  const clip = model?.lanes.find(l => l.id === selected?.laneId)?.clips.find(cl => cl.id === selected?.clipId);
  const range = useAppStore(s => s.sequencer.arrangerLoopSelection);
  const songLoop = useAppStore(s => s.sequencer.arrangerSongLoopEnabled);
  const ticksPerStep = sequencerTransportSubunitsPerStep();
  const position = useAppStore(({ sequencerRuntime: runtime }) => runtime.arrangerTransportSubunit ??
    absoluteTransportStep(runtime.playhead, runtime.cycle, runtime.stepCount) * ticksPerStep);
  const beatsPerBar = useAppStore(s => s.sequencer.timing.meterNumerator);
  const beat = Math.floor(position / QUARTER_TICKS);
  const bpm = useAppStore(s => s.sequencer.timing.tempoBPM);
  return <><button type="button" aria-pressed={model ? !!range : !!songLoop} title={model && clip ? c.loopClip : c.loopSong}
    onClick={() => {
      if (!model) useAppStore.getState().setSequencerArrangerSongLoopEnabled(!songLoop);
      else onSeek(range ? null : { startStep: (clip?.start ?? 0) / ticksPerStep, endStep: (clip ? clip.start + clip.length : model.end) / ticksPerStep });
    }}>{c.loop}</button>
    <span className="ws-bars" title={arrangeCopy(language).barBeat} aria-label={arrangeCopy(language).barBeat}>{Math.floor(beat / beatsPerBar) + 1}.{beat % beatsPerBar + 1}</span>
    <label>{c.position} <PositionInput className="ws-number" beats={position / QUARTER_TICKS} onSeek={step => onSeek(range, step)} /></label>
    <label>BPM <input className="ws-number" type="number" min={30} max={300} value={bpm} onChange={e => onTempo(Number(e.target.value))} /></label></>;
}

function MixProperties({ language }: { language: GuiLanguage }) {
  const [bindingId] = usePerformanceEditorState("mixer", "selected", "");
  const binding = useAppStore(s => s.sequencerInstruments.find(b => b.id === bindingId));
  const patch = useAppStore(s => s.patches.find(p => p.id === binding?.patchId));
  const strip = useAppStore(s => s.mixer.strips[bindingId]);
  const a = audioCopy(language), c = shellCopy[language];
  if (binding || bindingId === "$master") return <>
    <h3>{bindingId === "$master" ? a("master") : patch?.name}</h3>
    {binding && <p>{c.channel} · {binding.midiChannel || "—"}</p>}
    <p>{a("gain")} · {strip?.gainDb === null ? "−∞" : strip?.gainDb ?? 0} dB</p>
    <p>{a("balance")} · {strip?.balance ?? 0}</p></>;
  return <p>{c.select}</p>;
}

type Props = {
  view: PerformView; language: GuiLanguage; children: ReactNode; project: ReactNode; save: ReactNode; engine: ReactNode;
  transport: ReactNode; keyboard: ReactNode; name: string; midi: string; session: string;
  onSeek: SequencerPageTransportActions["onSequencerArrangerLoopSelectionChange"]; onTempo: (bpm: number) => void;
  error: string | null; onHelp?: () => void;
};

export default function WorkspaceShell({ view, language, children, project, save, engine, transport, keyboard, name, midi, session, error, onHelp, onSeek, onTempo }: Props) {
  const c = shellCopy[language], clip = clipCopy(language);
  const [layout, setLayout] = usePerformanceEditorState<PerformViewLayout>("page", "layout", {});
  const [remembered, remember] = usePerformanceEditorState<string | null>("page", "closedEditor", null);
  const clipKey = useAppStore(s => s.clipEditingKey);
  const model = useAppStore(s => s.sequencer.clipArrangement);
  const [selected] = usePerformanceEditorState<{ clipId?: string; laneId: string } | null>("arranger", "clipSelection", null);
  const drafts = useAppStore(s => s.clipDrafts);
  const musicalChanges = useMemo(() => hasChangedClipDrafts(model, drafts), [model, drafts]);
  const structuralChanges = useStructureDraft(s => !!s.draft?.cursor);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const appError = useAppStore(s => s.error || s.mixerSyncError);
  const issue = error || appError;
  const dock = view === "arrange" && model ? clipKey ? "editor" : layout.dock === "keyboard" ? "keyboard" : null : layout.dock;
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
  const overviewMinimum = view === "arrange" && model ? (size.width - sidebarWidth < 780 ? 312 : 245) : 165;
  const grip = coarse ? 24 : DIVIDER_HEIGHT;
  const narrow = size.width < 700 || window.innerHeight < 600 || size.height < MIN_DOCK + overviewMinimum + grip + 48;
  const inspector = narrow ? !!layout.drawerOpen : layout.inspectorOpen ?? view === "arrange";
  const single = !!dock && (narrow || !!layout.dockExpanded);
  useLayoutEffect(() => {
    const overview = main.current?.querySelector(".ws-overview");
    if (single && (document.activeElement === document.body || overview?.contains(document.activeElement))) back.current?.focus();
  }, [single, view]);
  const max = maxDockHeight(size.mainHeight, overviewMinimum, grip), height = clampDock(layout.preferredDockHeight ?? 260, max);
  const [launcherHost, setLauncherHost] = useState<HTMLDivElement | null>(null);
  const [editorHost, setEditorHost] = useState<HTMLDivElement | null>(null);
  const [commandHost, setCommandHost] = useState<HTMLSpanElement | null>(null);
  const [inspectorHost, setInspectorHost] = useState<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), drawerClose = useRef<HTMLButtonElement>(null);
  const focusDrawer = useRef(false);
  const dockId = useId(), inspectorId = useId(), diagnostics = useRef<HTMLDialogElement>(null);
  const projectMenu = useRef<HTMLDetailsElement>(null);
  const change = (patch: PerformViewLayout) => setLayout(previous => ({ ...previous, ...patch }));
  const closeInspector = () => { change(narrow ? { drawerOpen: false } : { inspectorOpen: false }); trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (focusDrawer.current && narrow && inspector) drawerClose.current?.focus();
    focusDrawer.current = false;
  }, [narrow, inspector]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (projectMenu.current?.open) { projectMenu.current.open = false; projectMenu.current.querySelector("summary")?.focus(); }
      else if (narrow && inspector) { setLayout(s => ({ ...s, drawerOpen: false })); trigger.current?.focus(); }
    };
    const outside = (e: PointerEvent) => {
      if (projectMenu.current?.open && !projectMenu.current.contains(e.target as Node)) projectMenu.current.open = false;
    };
    document.addEventListener("keydown", key); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", outside); };
  }, [narrow, inspector, setLayout]);
  const chooseDock = (next: "keyboard" | null) => {
    if (clipKey && view === "arrange") { remember(clipKey); useAppStore.setState({ clipEditingKey: null }); }
    change({ dock: next, dockExpanded: false });
  };
  useLayoutEffect(() => {
    if (view === "arrange" && clipKey && layout.dock === "keyboard") setLayout(s => ({ ...s, dock: "editor" }));
  }, [view, clipKey, layout.dock, setLayout]);
  const returnToOverview = () => {
    chooseDock(null);
    requestAnimationFrame(() => {
      const frame = work.current?.closest(".ws-shell");
      const source = dock === "keyboard" ? frame?.querySelector<HTMLButtonElement>("[data-keyboard-toggle]") :
        view === "live" ? frame?.querySelector<HTMLButtonElement>("[data-selected] [data-pad-editor-toggle]") : commandHost?.querySelector("button");
      (source ?? trigger.current)?.focus();
    });
  };
  const context = { slots: { launcher: launcherHost, editor: editorHost, inspector: inspectorHost, editorCommand: commandHost, dialogs: document.body },
    trackRouting: (id: string, kind: keyof typeof sourceKeys) => <ArrangeTrackRouting key={id} id={id} kind={kind} language={language} />,
    getRememberedTarget: () => {
      const target = remembered && survivingClipKey(remembered) ? useAppStore.getState().clipDrafts[remembered]?.target : undefined;
      return target?.laneId === selected?.laneId && target?.clipId === selected?.clipId ? target : undefined;
    },
    closeDock: () => chooseDock(null) };
  return <WorkspacePanels.Provider value={context}><section className="ws-shell">
    <div className="ws-commandbar">
      <details className="ws-project" ref={projectMenu}><summary>{c.project}</summary>
        <div className="ws-project-menu" onClick={e => { if ((e.target as Element).closest("button") && projectMenu.current) {
          projectMenu.current.open = false; projectMenu.current.querySelector("summary")?.focus();
        } }}
          onChange={e => { if (e.target instanceof HTMLSelectElement && projectMenu.current) projectMenu.current.open = false; }}>{project}</div></details>
      <strong className="ws-title" title={name}>{name}</strong>{save}
      <span className="ws-command-spacer" />
      <span className="ws-editor-command" ref={setCommandHost} />
      {view !== "mix" && <button data-keyboard-toggle aria-pressed={dock === "keyboard"} onClick={() => chooseDock(dock === "keyboard" ? null : "keyboard")}>{c.keyboard}</button>}
      <button ref={trigger} aria-expanded={inspector} aria-controls={inspectorId} onClick={() => {
        if (inspector) closeInspector();
        else { focusDrawer.current = narrow; change(narrow ? { drawerOpen: true } : { inspectorOpen: true }); }
      }}>{c.inspector}</button>{engine}
      {onHelp && <button title={c.help} aria-label={c.help} onClick={onHelp}>?</button>}
    </div>
    <div className="ws-work" ref={work} style={{ "--transport-height": size.height - size.mainHeight + "px" } as CSSProperties} data-sidebar={!narrow && inspector || undefined}>
      <div className="ws-column">
        <div className="ws-transport" role="group" aria-label={c.transport}>{transport}<SongPositionControls language={language} onSeek={onSeek} onTempo={onTempo} /></div>
        <div className="ws-panes" ref={main} style={{ "--dock-height": height + "px" } as CSSProperties} data-split={dock && !single || undefined}>
          <RetainedScroll key={view} owner="page" field="overviewScroll" className="ws-overview" hidden={single} role="region" aria-label={c.overview}>{children}</RetainedScroll>
          {dock && !single && <DockDivider key={view + dock} label={c.divider} controls={dockId} height={height} max={max} layoutWidth={size.mainWidth} layoutHeight={size.mainHeight} onCommit={preferredDockHeight => change({ preferredDockHeight })} />}
          {dock && <section id={dockId} className="ws-dock" data-compact-launch={view === "live" && single && dock === "keyboard" || undefined} aria-label={dock === "keyboard" ? c.keyboard : c.editor}>
            <header><h2>{dock === "keyboard" ? c.keyboard : c.editor}</h2>
              {!narrow && <button aria-expanded={!!layout.dockExpanded} onClick={() => change({ dockExpanded: !layout.dockExpanded })}>{layout.dockExpanded ? c.restore : c.expand}</button>}
              <button ref={back} onClick={returnToOverview}>{single ? c.back : c.close}</button></header>
            {view === "live" && single && dock === "keyboard" && <div className="ws-compact-launch" ref={setLauncherHost} />}
            {view === "arrange" && model && dock === "editor" ? <div className="ws-clip-editor-host" ref={setEditorHost} /> : <RetainedScroll key={view + dock} className="ws-dock-scroll" owner="page" field={dock + "Scroll"}>
              {dock === "keyboard" ? keyboard : <div ref={setEditorHost} />}
            </RetainedScroll>}
          </section>}
        </div>
      </div>
      {inspector && <aside id={inspectorId} aria-label={c.inspector} className="ws-inspector" data-drawer={narrow || undefined}>
        <header><h2>{c.inspector}</h2><button ref={drawerClose} aria-label={c.close + " · " + c.inspector} onClick={closeInspector}>×</button></header>
        <RetainedScroll owner="page" field={narrow ? "drawerScroll" : "inspectorScroll"} className="ws-inspector-scroll" key={view + String(narrow)}>
          {view !== "mix" ? <>{view === "arrange" && model && !selected && <p>{clip.select}</p>}<div ref={setInspectorHost} /></> : <MixProperties language={language} />}
        </RetainedScroll>
      </aside>}
    </div>
    <footer className="ws-status" aria-label={c.status}><span className="ws-session">{session}</span><span>{midi}</span>
      {(musicalChanges || structuralChanges) && <span className="text-amber-200">{clip.unsaved}</span>}
      {issue && <span role="alert" className="ws-error" title={issue}>{issue}</span>}
      <button onClick={() => { setDiagnosticsOpen(true); diagnostics.current?.showModal(); }}>{c.diagnostics}</button>
    </footer>
    <dialog ref={diagnostics} onClose={() => setDiagnosticsOpen(false)} aria-label={c.diagnostics} className="ws-dialog"><h2>{c.diagnostics}</h2>
      {issue && <p className="ws-error">{issue}</p>}
      {diagnosticsOpen && <EngineStatusLine embedded />}<p>{midi}</p>
      <button onClick={() => useAppStore.getState().setActivePage("config")}>{c.config}</button> <button autoFocus onClick={() => diagnostics.current?.close()}>{c.close}</button>
    </dialog>
  </section></WorkspacePanels.Provider>;
}
