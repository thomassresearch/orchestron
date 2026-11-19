import { useContext, useMemo } from "react";
import { playingClipPattern, clipAuditionDefinitions } from "../../lib/clipArranger/runtime";
import { sourceKeys } from "../../lib/clipArranger/migration";
import type { SourceKind } from "../../lib/clipArranger/model";
import { arrangementCopy } from "../../lib/arrangementCopy";
import { copyScorePad, removeScoreTrack } from "../../store/scoreActions";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage, SequencerState } from "../../types";
import { clipCopy } from "../clipArranger/copy";
import { LivePadEditorContext } from "../clipArranger/context";
import { arpeggiatorCopy } from "./arpeggiatorCopy";
import { scoreCopy } from "./scoreCopy";
import { LivePadBank } from "./LivePadBank";
import { copyArpeggiatorPad } from "../../lib/livePads";
import { liveCopy } from "./liveCopy";
import { WorkspacePanel } from "./WorkspacePanels";
import { PlaybackSourceToggle } from "./PlaybackSourceToggle";
import { usePerformanceEditorState, type PerformViewLayout } from "./PerformanceEditorState";
import type { DeviceEditorRenderer } from "./PerformWorkspace";
import { ScoreTransportContext } from "./ScoreTransportContext";
import type { SequencerPageArpeggiatorActions, SequencerPageControllerSequencerActions, SequencerPageDrummerTrackActions, SequencerPageMelodicTrackActions } from "./sequencerPageContracts";

type Actions = Pick<SequencerPageMelodicTrackActions, "onRemoveSequencerTrack" | "onSequencerPadPress" | "onSequencerPadCopy" | "onSequencerPadTransposeShort" | "onSequencerPadTransposeLong" | "onSequencerTrackEnabledChange" | "onSequencerTrackPadLoopEnabledChange">
  & Pick<SequencerPageDrummerTrackActions, "onRemoveDrummerSequencerTrack" | "onDrummerSequencerPadPress" | "onDrummerSequencerPadCopy" | "onDrummerSequencerTrackEnabledChange" | "onDrummerSequencerTrackPadLoopEnabledChange">
  & Pick<SequencerPageControllerSequencerActions, "onRemoveControllerSequencer" | "onControllerSequencerPadPress" | "onControllerSequencerPadCopy" | "onControllerSequencerEnabledChange" | "onControllerSequencerPadLoopEnabledChange">
  & Pick<SequencerPageArpeggiatorActions, "onRemoveArpeggiator" | "onArpeggiatorCommand" | "onArpeggiatorEnabledChange" | "onArpeggiatorChange">;
const kinds = Object.keys(sourceKeys) as SourceKind[];
type Device = SequencerState[(typeof sourceKeys)[SourceKind]][number];

function PadSaveStatus({ kind, id, pad, language }: { kind: SourceKind; id: string; pad: number; language: GuiLanguage }) {
  const device = useAppStore(s => s.sequencer[sourceKeys[kind]].find(t => t.id === id));
  const baseline = useAppStore(s => s.savedPerformanceSequencer);
  const savedDevice = baseline?.[sourceKeys[kind]].find(t => t.id === id);
  const current = device?.pads[pad], saved = savedDevice?.pads[pad];
  const samePreset = device && savedDevice && "padPresetIds" in device && "padPresetIds" in savedDevice
    ? device.padPresetIds[pad] === savedDevice.padPresetIds[pad] : true;
  const matches = useMemo(() => !!saved && (saved === current || JSON.stringify(saved) === JSON.stringify(current)), [saved, current]);
  const status = baseline ? matches && samePreset ? "saved" : "unsaved" : "saveHint";
  return <span className="ws-pad-save">{liveCopy(language)(status)}</span>;
}

export function LiveLauncher({ sequencer, language, engineRunning, actions, add, canRemove, renderEditor }: {
  sequencer: SequencerState; language: GuiLanguage; engineRunning: boolean; actions: Actions; canRemove: boolean;
  add: (kind: SourceKind) => void; renderEditor: DeviceEditorRenderer;
}) {
  const [id, select] = usePerformanceEditorState("page", "liveDevice", "");
  const [layout, setLayout] = usePerformanceEditorState<PerformViewLayout>("page", "layout", {});
  const pads = useAppStore(s => s.sequencerEditingPads);
  const score = useContext(ScoreTransportContext);
  const authored = useAppStore(s => s.sequencer);
  const runtime = useAppStore(s => s.sequencerRuntime);
  const auditions = useAppStore(s => s.performanceAuditions);
  const draft = useAppStore(s => s.clipAuditionDraft);
  const selectPad = useAppStore(s => s.selectSequencerEditingPad);
  const c = liveCopy(language), a = arpeggiatorCopy(language), sc = scoreCopy(language), source = arrangementCopy(language), types = clipCopy(language);
  const devices = kinds.flatMap(kind => sequencer[sourceKeys[kind]].map(track => ({ kind, track })));
  const selected = devices.find(d => d.track.id === id) ?? devices[0];
  const fail = (error: unknown) => useAppStore.setState({ error: String(error) });
  const editing = ({ kind, track }: { kind: SourceKind; track: Device }) => pads[track.id] ?? authored[sourceKeys[kind]].find(t => t.id === track.id)?.activePad ?? 0;

  const play = (kind: SourceKind, track: Device, enabled: boolean, pad: number) => {
    const id = track.id;
    switch (kind) {
      case "sequencer": return actions.onSequencerTrackEnabledChange(id, enabled);
      case "drummer": return actions.onDrummerSequencerTrackEnabledChange(id, enabled);
      case "controller": return actions.onControllerSequencerEnabledChange(id, enabled);
      case "score": return void score?.play(id, enabled).catch(fail);
      case "arpeggiator":
        if (enabled && "playbackMode" in track && track.playbackMode === "live" && track.activePad !== pad) {
          actions.onArpeggiatorChange(id, { activePad: pad });
        }
        return actions.onArpeggiatorEnabledChange(id, enabled);
    }
  };
  const changeSource = (kind: SourceKind, id: string, enabled: boolean) => {
    switch (kind) {
      case "sequencer": return actions.onSequencerTrackPadLoopEnabledChange(id, enabled);
      case "drummer": return actions.onDrummerSequencerTrackPadLoopEnabledChange(id, enabled);
      case "controller": return actions.onControllerSequencerPadLoopEnabledChange(id, enabled);
      case "score": {
        const state = useAppStore.getState();
        state.commitArrangerEdit("source", [{ id, kind, source: enabled }]);
        if (sequencer.isPlaying && sequencer.scoreTracks.find(t => t.id === id)?.enabled) void score?.play(id, true).catch(fail);
        return;
      }
      case "arpeggiator": return actions.onArpeggiatorChange(id, { padLoopEnabled: enabled });
    }
  };
  const row = ({ kind, track }: { kind: SourceKind; track: Device }, compact: boolean) => {
    const lane = sequencer.clipArrangement?.lanes.find(l => l.id === track.id);
    const arp = "playbackMode" in track ? track : undefined;
    const liveArp = !lane && arp?.playbackMode === "live";
    const manual = !lane && (liveArp || !track.padLoopEnabled);
    const preview = auditions[track.id];
    const deviceRunning = arp ? liveArp ? arp.enabled : !!arp.runtimeStatus?.enabled : sequencer.isPlaying && track.enabled;
    const running = engineRunning && (preview?.preview_source_running ?? deviceRunning);
    const active = preview?.manual_active_pad ?? (arp ? arp.runtimeStatus?.active_pad : track.activePad);
    const deviceQueue = arp ? arp.runtimeStatus?.queued_pad : "queuedPad" in track ? track.queuedPad : null;
    const manualQueue = preview?.manual_active_pad !== undefined ? preview.manual_queued_pad : deviceQueue;
    const queued = running && manual ? manualQueue : null;
    const rest = !manual && "padLoopSequence" in track && track.padLoopPosition != null && track.padLoopSequence[track.padLoopPosition] < 0;
    const arpWaiting = arp?.runtimeStatus?.state && arp.runtimeStatus.state !== "playing";
    const sounding = running && !rest && !arpWaiting ? active : null;
    let playingLabel: string | number = sounding == null ? "—" : sounding + 1;
    if (lane && sounding != null) {
      const audition = auditions[track.id];
      if (audition?.workspace_active && draft?.target.laneId === track.id) {
        const definitions = clipAuditionDefinitions(lane, draft).filter(d => d.kind === "pattern");
        playingLabel = definitions[sounding]?.name ?? "—";
      } else {
        const timing = "automationTarget" in track && track.automationTarget
          ? { ...track.timing, controllerMode: track.controllerMode, automation: true } : "timing" in track ? track.timing : undefined;
        playingLabel = playingClipPattern(lane, sequencer.clipArrangement!.end, runtime, timing)?.name ?? "—";
      }
    }
    const current = editing({ kind, track });
    const choosePad = (pad: number) => {
      select(track.id);
      selectPad(track.id, pad);
      if (!manual || !running) return;
      switch (kind) {
        case "sequencer": return actions.onSequencerPadPress(track.id, pad);
        case "drummer": return actions.onDrummerSequencerPadPress(track.id, pad);
        case "controller": return actions.onControllerSequencerPadPress(track.id, pad);
        case "score": return void score?.queue(track.id, pad === active ? null : pad).catch(fail);
        case "arpeggiator": return actions.onArpeggiatorCommand?.(track.id, pad === active ? { command: "cancel" } : { command: "launch", pad_index: pad });
      }
    };
    const boundary = arp ? arp.launchQuantize === "bar" ? a.nextBar : a.nextCycle : "launchQuantization" in track ? track.launchQuantization === "bar" ? sc.bar : sc.end : c("boundary");
    return <div key={track.id} className="ws-live-row" data-live-device={track.id} data-selected={selected?.track.id === track.id || undefined} role="group" aria-label={track.name}>
      <div className="ws-live-device">
        {compact ? <select aria-label={c("device")} value={track.id} onChange={e => select(e.target.value)}>{devices.map(d => <option key={d.track.id} value={d.track.id}>{d.track.name}</option>)}</select>
          : <button className="ws-live-name" aria-pressed={selected?.track.id === track.id} onClick={() => select(track.id)}>{track.name}</button>}
        <span>{liveArp ? a.live : manual ? source.manual : source.arrangement}{manual && <> · {boundary}</>}</span>
      </div>
      <LivePadBank device={authored[sourceKeys[kind]].find(t => t.id === track.id) ?? track} language={language}
        editing={current} sounding={lane ? null : sounding} queued={queued} onLaunch={choosePad}
        onCopy={(from, to) => {
          switch (kind) {
            case "sequencer": return actions.onSequencerPadCopy(track.id, from, to);
            case "drummer": return actions.onDrummerSequencerPadCopy(track.id, from, to);
            case "controller": return actions.onControllerSequencerPadCopy(track.id, from, to);
            case "score": return copyScorePad(track.id, from, to);
            case "arpeggiator": if (arp) actions.onArpeggiatorChange(track.id, copyArpeggiatorPad(arp, from, to)); break;
          }
        }}
        onTranspose={kind === "sequencer" ? (pad, direction, keyStep) =>
          (keyStep ? actions.onSequencerPadTransposeLong : actions.onSequencerPadTransposeShort)(track.id, pad, direction) : undefined} />
      <div className="ws-live-actions"><button type="button" aria-pressed={running} onClick={() => { select(track.id); play(kind, track, !running, current); }}>{running ? sc.stop : sc.play}</button>
        <button data-pad-editor-toggle aria-expanded={layout.dock === "editor" && selected?.track.id === track.id} onClick={() => { select(track.id); selectPad(track.id, current); setLayout(previous => ({ ...previous, dock: "editor" })); }}>{c("edit")}</button></div>
      <div className="ws-live-state"><span>{a.editing} <b>{current + 1}</b></span><span>{a.playing} <b>{playingLabel}</b></span><span>{a.queued} <b>{queued == null ? "—" : queued + 1}</b></span></div>
    </div>;
  };
  const addDevice = (kind: SourceKind) => {
    const key = sourceKeys[kind];
    const before = useAppStore.getState().sequencer[key];
    try {
      add(kind);
      const created = useAppStore.getState().sequencer[key].find(t => !before.some(old => t.id === old.id));
      if (!created) return;
      if (created.padLoopEnabled) changeSource(kind, created.id, false);
      select(created.id);
    } catch (error) {
      fail(error);
    }
  };
  const removeDevice = {
    sequencer: actions.onRemoveSequencerTrack, drummer: actions.onRemoveDrummerSequencerTrack,
    controller: actions.onRemoveControllerSequencer, score: removeScoreTrack, arpeggiator: actions.onRemoveArpeggiator
  };
  const selectedLane = sequencer.clipArrangement?.lanes.find(lane => lane.id === selected?.track.id);
  return <>
    <section className="ws-launcher" aria-label={c("launcher")}>
      <header><h2>{c("launcher")}</h2><label>{c("add")} <select value="" onChange={e => addDevice(e.target.value as SourceKind)}><option value="">＋</option>{kinds.map(k => <option key={k} value={k}>{types[k === "sequencer" ? "melodic" : k]}</option>)}</select></label></header>
      {devices.map(d => row(d, false))}
    </section>
    {selected && <>
      <WorkspacePanel name="launcher">{row(selected, true)}</WorkspacePanel>
      <WorkspacePanel name="inspector"><h3>{selected.track.name}</h3>
        <p>{types[selected.kind === "sequencer" ? "melodic" : selected.kind]} · MIDI {"targetChannels" in selected.track ? selected.track.targetChannels.join(", ") : "targetChannel" in selected.track ? selected.track.targetChannel : selected.track.midiChannel}</p>
        {selectedLane ? <p>{source.source} · {source.arrangement}</p>
          : "playbackMode" in selected.track && selected.track.playbackMode === "live" ? <p>{source.source} · {a.live}</p>
          : <PlaybackSourceToggle language={language} arrangement={selected.track.padLoopEnabled} hasArrangement={!!selected.track.padLoopPattern.rootSequence.length} onChange={value => changeSource(selected.kind, selected.track.id, value)} />}
        <p>{a.editing} · Pad {editing(selected) + 1}</p>
        {!selectedLane && <button type="button" disabled={!canRemove && selected.kind !== "score"}
          onClick={() => removeDevice[selected.kind](selected.track.id)}>{c("remove")}</button>}
      </WorkspacePanel>
      {layout.dock === "editor" && <WorkspacePanel name="editor"><header className="ws-live-editor-heading"><h3>{selected.track.name} / Pad {editing(selected) + 1}</h3>
        <PadSaveStatus kind={selected.kind} id={selected.track.id} pad={editing(selected)} language={language} /></header>
        <LivePadEditorContext.Provider value><div key={selected.track.id}>{renderEditor(selected.kind, selected.track.id, sequencer)}</div></LivePadEditorContext.Provider>
      </WorkspacePanel>}
    </>}
  </>;
}
