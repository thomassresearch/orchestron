import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { audioPorts } from "../lib/audioBlocks";
import { audioCopy } from "../lib/audioCopy";
import { emptyAudioGraph, emptyMixer, newRoute } from "../lib/audioRouting";
import { audioTemplate } from "../lib/audioTemplates";
import { BrowserClockAudioClient } from "../lib/browserClockAudio";
import { normalizeSessionInstrumentAssignments } from "../store/appStoreModel";
import { useAppStore } from "../store/useAppStore";
import type { Patch, SequencerState, SequencerRuntimeState, SessionSequencerConfigRequest, SessionMidiEventRequest } from "../types";

export function AuditionPanel({ stopPerformance, buildConfig }: { stopPerformance: () => Promise<void>; buildConfig: (state: SequencerState) => SessionSequencerConfigRequest }) {
  const draft = useAppStore((s) => s.currentPatch);
  const bindings = useAppStore((s) => s.sequencerInstruments);
  const patches = useAppStore((s) => s.patches);
  const language = useAppStore((s) => s.guiLanguage); const t = audioCopy(language);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"isolated" | "performance">("isolated");
  const [instance, setInstance] = useState("");
  const [sourceId, setSourceId] = useState("builtin-instrument");
  const [prepared, setPrepared] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<{ id: string; midi: number[]; signature: string; config?: SessionSequencerConfigRequest; controllers: SessionMidiEventRequest[] } | null>(null);
  const original = useRef<{ sequencer: SequencerState; runtime: SequencerRuntimeState } | null>(null);
  const client = useMemo(() => new BrowserClockAudioClient({ onStatusChange: () => undefined, onErrorChange: (message) => { if (message) setError(message); }, onSequencerStatus: () => undefined, getLatencySettings: () => useAppStore.getState().browserClockLatencySettings }), []);
  const cleanup = async () => {
    await client.disconnect();
    const current = preview.current; preview.current = null;
    if (current) { try { await api.stopSession(current.id); } finally { await api.deleteSession(current.id); } }
    if (original.current) {
      useAppStore.setState({ sequencer: { ...original.current.sequencer, isPlaying: false }, sequencerRuntime: { ...original.current.runtime, isPlaying: false } });
      original.current = null;
    }
  };
  useEffect(() => () => { void cleanup().catch(() => undefined); }, [client]);
  const prepare = async () => {
    setBusy(true); setError(null);
    try {
      await cleanup();
      const state = useAppStore.getState();
      const patch: Patch = { ...structuredClone(draft), id: crypto.randomUUID(), is_template: false, created_at: draft.created_at || new Date().toISOString(), updated_at: draft.updated_at || new Date().toISOString() };
      const inline = [patch]; let graph = emptyAudioGraph(); let mixer = emptyMixer();
      const midi: number[] = [];
      const controllers: SessionMidiEventRequest[] = [];
      let assignments = [{ id: "preview", patch_id: patch.id, midi_channel: patch.always_on ? 0 : 1 }];
      let config: SessionSequencerConfigRequest | undefined;
      if (mode === "performance") {
        const matching = bindings.filter((b) => b.patchId === draft.id);
        const chosen = instance || (matching.length === 1 ? matching[0].id : "");
        if (!chosen) throw new Error(t("inPerformance") + ": " + t("source"));
        const row = bindings.find((b) => b.id === chosen); if (!row) throw new Error(t("missing"));
        assignments = normalizeSessionInstrumentAssignments(bindings).map((b) => ({ id: b.id!, patch_id: b.id === chosen ? patch.id : b.patch_id, midi_channel: b.id === chosen ? patch.always_on ? 0 : row.midiChannel || 1 : b.midi_channel }));
        graph = structuredClone(state.audioGraph); mixer = structuredClone(state.mixer); config = buildConfig(structuredClone(state.sequencer));
        for (const controller of state.sequencer.midiControllers.filter((c) => c.enabled)) {
          for (const channel of new Set(assignments.map((b) => b.midi_channel).filter((c) => c > 0))) controllers.push({ type: "control_change", channel, controller: controller.controllerNumber, value: controller.value });
        }
        if (!patch.always_on) midi.push(row.midiChannel || 1);
      } else {
        const output = audioTemplate("output"); output.id = crypto.randomUUID(); output.created_at = patch.created_at; output.updated_at = patch.updated_at; inline.push(output);
        assignments.push({ id: "preview-output", patch_id: output.id, midi_channel: 0 }); graph.masterId = "preview-output";
        const ports = patch.graph.audio_interface?.groups.find((g) => g.id === patch.graph.audio_interface?.mainOutput)?.ports ?? audioPorts(patch.graph, "output");
        if (ports.length !== 2) throw new Error(t("mapping") + ": " + ports.join(" / "));
        graph.routes.push(...ports.map((sourcePort, i) => newRoute({ sourceId: "preview", sourcePort, targetId: "preview-output", targetPort: i ? "right" : "left", kind: "main", sourceStage: "strip", targetStage: "input" })));
        const inlets = patch.graph.audio_interface?.groups.find((g) => g.id === patch.graph.audio_interface?.mainInput)?.ports ?? audioPorts(patch.graph, "input");
        if (inlets.length) {
          const source = sourceId === "builtin-instrument" ? audioTemplate("instrument") : await api.getPatch(sourceId);
          source.id = crypto.randomUUID(); source.created_at = patch.created_at; source.updated_at = patch.updated_at; source.is_template = false; inline.push(source);
          const outputs = source.graph.audio_interface?.groups.find((g) => g.id === source.graph.audio_interface?.mainOutput)?.ports ?? audioPorts(source.graph, "output");
          if (outputs.length !== inlets.length) throw new Error(t("mapping"));
          assignments.push({ id: "preview-source", patch_id: source.id, midi_channel: source.always_on ? 0 : 2 });
          graph.routes.push(...outputs.map((sourcePort, i) => newRoute({ sourceId: "preview-source", sourcePort, targetId: "preview", targetPort: inlets[i], kind: "main", sourceStage: "strip", targetStage: "input" })));
          if (!source.always_on) midi.push(2);
        }
        if (!patch.always_on) midi.push(1);
      }
      const response = await api.createPreview({ patches: inline, session: { instruments: assignments, audio_graph: graph, mixer } });
      preview.current = { id: response.session_id, midi, signature: JSON.stringify(draft), config, controllers };
      await api.compileSession(response.session_id);
      setPrepared(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setPrepared(false); await cleanup().catch(() => undefined); }
    finally { setBusy(false); }
  };
  const start = async () => {
    const current = preview.current; if (!current) return;
    if (current.signature !== JSON.stringify(draft)) { setPrepared(false); return; }
    setBusy(true);
    try {
      await client.prime();
      const state = useAppStore.getState(); original.current = { sequencer: structuredClone(state.sequencer), runtime: structuredClone(state.sequencerRuntime) };
      await stopPerformance();
      if (useAppStore.getState().activeSessionState === "running" || useAppStore.getState().activeSessionState === "error") throw new Error(t("stop"));
      await api.startSession(current.id); await client.connect(current.id);
      for (const controller of current.controllers) await client.sendManualMidi(current.id, controller);
      if (current.config) await client.startSequencer(current.id, { config: current.config, positionStep: original.current.runtime.playhead });
      for (const channel of current.midi) await client.sendManualMidi(current.id, { type: "note_on", channel, note: 60, velocity: 96 });
      setPlaying(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); await cleanup().catch(() => undefined); setPrepared(false); }
    finally { setBusy(false); }
  };
  const field = "rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm disabled:opacity-40";
  return <><button className="rounded border border-cyan-500/60 bg-cyan-950 px-3 py-1 text-xs text-cyan-100" onClick={() => { setOpen(true); const matching = bindings.filter((b) => b.patchId === draft.id); setInstance(matching.length === 1 ? matching[0].id : ""); }}>{t("audition")}</button>
    {open && <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/80 p-4"><div role="dialog" aria-modal="true" aria-label={t("audition")} className="w-full max-w-xl rounded-xl border border-cyan-700 bg-slate-900 p-5 text-slate-100">
      <p className="mb-3 text-lg">{t("audition")} · {draft.name}</p>
      <div className="flex flex-wrap gap-2"><select className={field} disabled={playing || busy} value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); setPrepared(false); }}><option value="isolated">{t("isolated")}</option><option value="performance">{t("inPerformance")}</option></select>
      {mode === "performance" ? <select className={field} aria-label={t("source")} disabled={playing || busy} value={instance} onChange={(e) => { setInstance(e.target.value); setPrepared(false); }}><option value="">—</option>{bindings.map((b) => <option key={b.id} value={b.id}>{patches.find((p) => p.id === b.patchId)?.name} · {b.id.slice(0, 4)}</option>)}</select> : audioPorts(draft.graph, "input").length > 0 && <label className="text-xs">{t("testSource")}<select className={field} disabled={playing || busy} value={sourceId} onChange={(e) => { setSourceId(e.target.value); setPrepared(false); }}><option value="builtin-instrument">{t("instrument")}</option>{patches.filter((p) => !p.audio_inlet_names.length && (p.audio_outlet_names.length || p.has_direct_output)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}</div>
      {error && <p role="alert" className="my-3 text-sm text-rose-300">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">{!playing && <button className={field} disabled={busy} onClick={() => void (prepared ? start() : prepare())}>{prepared ? t("stopAudition") : t("prepare")}</button>}
      <button className={field} disabled={busy} onClick={() => { setBusy(true); void cleanup().catch((e: unknown) => setError(String(e))).finally(() => { setOpen(false); setPlaying(false); setPrepared(false); setBusy(false); }); }}>{t("closeAudition")}</button></div>
    </div></div>}
  </>;
}
