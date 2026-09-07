import { MixerKnob } from "./MixerKnob";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api } from "../api/client";
import { audioCopy } from "../lib/audioCopy";
import { audioGraphDiagnostics, defaultStrip, mainPorts, newRoute, outputPorts, suggestedInterface } from "../lib/audioRouting";
import { insertChain, wireInsertChain } from "../lib/insertRouting";
import { meterSnapshot, subscribeMeters } from "../lib/mixerRuntime";
import { normalizeSessionInstrumentAssignments } from "../store/appStoreModel";
import { useAppStore } from "../store/useAppStore";
import type { AudioDiagnostic, AudioRoute, GuiLanguage } from "../types";

const field = "min-w-0 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100";
const diagnosticKeys: Record<string, Parameters<ReturnType<typeof audioCopy>>[0]> = { missing_patch: "missing", broken_route: "brokenRoute", feedback: "feedback", no_output_path: "noOutput", no_audio_source: "noInput", parallel_output: "parallelOutput", incomplete_stereo: "incompleteStereo", unconnected_input: "unusedInput", unconnected_output: "unusedOutput" };
const button = "rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-700 disabled:opacity-40";
function Meter({ id, name }: { id: string; name: string }) {
  const value = useSyncExternalStore(subscribeMeters, () => meterSnapshot(id));
  const db = (gain: number) => gain > 0 ? Math.max(-60, 20 * Math.log10(gain)) : -60;
  return <div className="my-2" aria-label={`${name} meter`}>
    {(["L", "R"] as const).map((side) => <div key={side} className="mb-1 flex items-center gap-1 text-[9px]">
      <span>{side}</span><div className="relative h-2 flex-1 overflow-hidden rounded bg-slate-950">
        <div className="absolute h-full bg-emerald-500/70" style={{ width: `${(db(value[`rms${side}`]) + 60) / 60 * 100}%` }} />
        <div className="absolute h-full w-0.5 bg-amber-200" style={{ left: `${Math.min(99, (db(value[`peak${side}`]) + 60) / 60 * 100)}%` }} />
      </div><span className={value[`peak${side}`] >= 1 ? "text-red-400" : "text-slate-500"}>{value[`peak${side}`] >= 1 ? "CLIP" : value[`peak${side}`] > 0 ? db(value[`peak${side}`]).toFixed(0) : "−∞"}</span>
    </div>)}
  </div>;
}
function Gain({ value, max = 12, label, onChange, onFinal, vertical = false, language }: { value: number | null; max?: number; label: string; onChange: (value: number | null) => void; onFinal: () => void; vertical?: boolean; language: GuiLanguage }) {
  const t = audioCopy(language);
  return <label className={`flex gap-2 ${vertical ? "flex-col items-center" : "items-center"}`}>
    <span className="text-xs text-slate-400">{label}</span>
    {!vertical ? <MixerKnob value={value ?? -61} min={-61} max={max} step={0.1} label={label} valueText={value === null ? "−∞ dB" : `${value} dB`} onChange={(v) => onChange(v <= -61 ? null : Math.max(-60, v))} onFinal={onFinal} /> : <input type="range" min={-61} max={max} step={0.1} value={value ?? -61} aria-label={label} title={t("reset")}
      onChange={(e) => onChange(Number(e.target.value) <= -61 ? null : Math.max(-60, Number(e.target.value)))} onPointerUp={onFinal} onKeyUp={onFinal} onDoubleClick={() => { onChange(0); onFinal(); }}
      className={vertical ? "h-36 accent-cyan-400 [direction:rtl] [writing-mode:vertical-lr]" : "w-24 accent-cyan-400"} />}
    <span className="flex items-center gap-1"><input className={`${field} w-16 text-center`} aria-label={`${label} dB`} type="number" min={-60} max={max} step={0.1} placeholder="−∞" value={value ?? ""}
      onChange={(e) => { const n = e.target.value === "" ? null : Number(e.target.value); if (n === null || Number.isFinite(n)) onChange(n === null ? null : Math.max(-60, Math.min(max, n))); }} onBlur={onFinal} /><span className="text-[10px] text-slate-400">dB</span></span>
  </label>;
}
export function PerformMixer({ onStop }: { onStop: () => void }) {
  const graph = useAppStore((s) => s.audioGraph);
  const mixer = useAppStore((s) => s.mixer);
  const bindings = useAppStore((s) => s.sequencerInstruments);
  const patches = useAppStore((s) => s.patches);
  const language = useAppStore((s) => s.guiLanguage);
  const running = useAppStore((s) => s.activeSessionState === "running");
  const notice = useAppStore((s) => s.migrationNotice);
  const syncError = useAppStore((s) => s.mixerSyncError);
  const t = audioCopy(language);
  const [selected, select] = useState<string>("");
  const [target, setTarget] = useState("");
  const [sourcePort, setSourcePort] = useState("");
  const [targetPort, setTargetPort] = useState("");
  const [purpose, setPurpose] = useState<"main" | "send" | "custom">("main");
  const [stereo, setStereo] = useState(true);
  const [processor, setProcessor] = useState("");
  const [diagnostics, setDiagnostics] = useState<AudioDiagnostic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(bindings.map((b) => [b.id, patches.find((p) => p.id === b.patchId)])), [bindings, patches]);
  const name = (id: string) => id === "$output" ? t("audioOutput") : byId.get(id)?.name ?? `${t("missing")}: ${id}`;
  const routingGroup = (id: string, direction: "input" | "output") => {
    const patch = byId.get(id);
    const info = patch?.audio_interface ?? (patch ? suggestedInterface(patch) : undefined);
    const mainId = direction === "input" ? info?.mainInput : info?.mainOutput;
    return info?.groups.find((g) => g.id === mainId) ?? info?.groups.find((g) => g.direction === direction);
  };
  const applyGraph = useAppStore((s) => s.setAudioGraph);
  const setStrip = useAppStore((s) => s.setMixerStrip);
  const setSend = useAppStore((s) => s.setMixerSend);
  const flush = () => { void useAppStore.getState().flushMixer().catch((e: unknown) => setError(String(e))); };
  const open = (id: string) => { const binding = bindings.find((b) => b.id === id); if (binding) void useAppStore.getState().loadPatch(binding.patchId).then(() => useAppStore.getState().setActivePage("instrument")); };
  const groups = useMemo(() => {
    const result = new Map<string, AudioRoute[]>();
    for (const r of graph.routes) {
      const patch = byId.get(r.sourceId);
      const group = (patch?.audio_interface ?? (patch ? suggestedInterface(patch) : undefined))?.groups.find((g) => g.direction === "output" && g.layout === "stereo" && g.ports.includes(r.sourcePort));
      const controls = mixer.sends[r.id];
      const key = [r.sourceId, r.targetId, r.kind, r.sourceStage, r.targetStage, group?.id ?? r.sourcePort, controls?.gainDb ?? "silent", controls?.tap ?? "post"].join("\0");
      result.set(key, [...result.get(key) ?? [], r]);
    }
    return [...result.values()];
  }, [graph, byId, mixer.sends]);
  const removeRoutes = (routes: AudioRoute[]) => {
    const ids = new Set(routes.map((r) => r.id));
    applyGraph({ ...graph, routes: graph.routes.filter((r) => !ids.has(r.id)) });
    const sends = { ...mixer.sends }; ids.forEach((id) => delete sends[id]);
    useAppStore.setState({ mixer: { ...mixer, sends } });
  };
  const check = async () => {
    try { setError(null); const result = await api.validateAudio(normalizeSessionInstrumentAssignments(bindings), graph, mixer); setDiagnostics(result.diagnostics); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { setDiagnostics([]); }, [graph]);
  const add = () => {
    const sourceGroup = routingGroup(selected, "output");
    const targetGroup = routingGroup(target, "input");
    const outputs = stereo ? sourceGroup?.ports ?? [] : [sourcePort];
    const inputs = stereo ? target === "$output" ? ["left", "right"] : targetGroup?.ports ?? [] : [targetPort];
    if (!outputs.length || outputs.length !== inputs.length || outputs.some((p) => !p) || inputs.some((p) => !p)) { setError(t("mapping")); return; }
    const routes = outputs.map((port, i) => newRoute({ sourceId: selected, sourcePort: port, targetId: target, targetPort: inputs[i], kind: purpose, sourceStage: "strip", targetStage: "input" }));
    if (graph.routes.length + routes.length > 1024) { setError(t("routeLimit")); return; }
    applyGraph({ ...graph, routes: [...graph.routes, ...routes] });
    if (purpose === "send") setSend(routes.map((r) => r.id), { gainDb: null, tap: "post" });
    setError(null);
  };
  const insert = () => {
    try {
      if (!processor || !selected || running) return;
      const chain = insertChain(graph, selected); if (!chain) throw new Error(t("custom"));
      const id = crypto.randomUUID(); const next = [...bindings, { id, patchId: processor, midiChannel: 0, level: 10, effectRoutes: [], effectSourceIds: [] }];
      if (next.length > 64) throw new Error(t("instanceLimit"));
      const audioGraph = wireInsertChain(graph, next, patches, selected, [...chain, id]);
      if (audioGraph.routes.length > 1024) throw new Error(t("routeLimit"));
      useAppStore.setState({ sequencerInstruments: next, audioGraph });
    } catch (e) { setError(String(e)); }
  };
  const throughMaster = async (id: string) => {
    try {
      const masterId = await useAppStore.getState().ensureMaster();
      const current = useAppStore.getState(); const ports = mainPorts(byId.get(id), "output");
      const masterPatchId = current.sequencerInstruments.find((b) => b.id === masterId)?.patchId;
      const inputs = mainPorts(current.patches.find((p) => p.id === masterPatchId), "input");
      if (ports.length !== 2 || inputs.length !== 2 || id === masterId) throw new Error(t("mapping"));
      applyGraph({ ...current.audioGraph, routes: [...current.audioGraph.routes.filter((r) => !(r.sourceId === id && r.kind === "main")), ...ports.map((sourcePort, i) => newRoute({ sourceId: id, sourcePort, targetId: masterId, targetPort: inputs[i], kind: "main", sourceStage: "strip", targetStage: "input" }))] });
    } catch (e) { setError(String(e)); }
  };
  const strip = (id: string) => {
    const state = mixer.strips[id] ?? defaultStrip(); const patch = byId.get(id); const master = graph.masterId === id;
    const direct = !master && patch?.has_direct_output && !graph.routes.some((r) => r.sourceId === id && r.sourcePort.startsWith("$direct") && r.kind === "main");
    const chain = insertChain(graph, id);
    return <article key={id} className={`w-52 shrink-0 rounded-lg border p-3 ${master ? "sticky right-0 z-10 ml-auto border-cyan-600 bg-slate-900 shadow-[-8px_0_16px_#020617]" : selected === id ? "border-cyan-500 bg-slate-800" : "border-slate-700 bg-slate-900"}`}>
      <button className="w-full truncate text-left text-sm font-semibold" onClick={() => select(id)}>{master ? `${t("master")} · ` : ""}{name(id)}</button>
      <div className="my-1 min-h-8 text-[10px] text-slate-400">{direct ? <span className="rounded border border-amber-600 px-1 text-amber-200">{t("direct")}</span> : [...new Set(graph.routes.filter((r) => r.sourceId === id && r.kind !== "insert").map((r) => name(r.targetId)))].join(", ") || (master ? t("audioOutput") : "—")}</div>
      <Meter id={id} name={name(id)} />
      <label className="flex flex-col text-[10px] text-slate-400">{t("balance")}<span className="self-center"><MixerKnob label={`${name(id)} ${t("balance")}`} min={-1} max={1} step={0.01} value={state.balance} onChange={(balance) => setStrip(id, { balance })} onFinal={flush} /></span>
        <input aria-label={`${name(id)} ${t("balance")} value`} className={`${field} my-1 w-20 self-center text-center`} type="number" min={-1} max={1} step={0.01} value={state.balance} onChange={(e) => setStrip(id, { balance: Math.max(-1, Math.min(1, Number(e.target.value))) })} onBlur={flush} /></label>
      <Gain value={state.gainDb} label={t("gain")} vertical language={language} onChange={(gainDb) => setStrip(id, { gainDb })} onFinal={flush} />
      <div className="my-3 flex justify-center gap-2"><button className={`${button} ${state.mute ? "bg-rose-800" : ""}`} aria-pressed={state.mute} onClick={() => { setStrip(id, { mute: !state.mute }); flush(); }}>{t("mute")}</button>{!master && <button className={`${button} ${state.solo ? "bg-amber-700" : ""}`} aria-pressed={state.solo} onClick={() => { setStrip(id, { solo: !state.solo }); flush(); }}>{t("solo")}</button>}</div>
      <details className="text-xs"><summary>{t("inserts")} · {chain?.length ?? t("custom")}</summary>{chain?.map((processorId, i) => <div key={processorId} className="my-1 flex items-center gap-1"><button className="truncate" onClick={() => open(processorId)}>{name(processorId)}</button><button disabled={running || !i} className={button} onClick={() => { const next = [...chain]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; applyGraph(wireInsertChain(graph, bindings, patches, id, next)); }}>↑</button><button disabled={running} className={button} onClick={() => { const audioGraph = wireInsertChain(graph, bindings, patches, id, chain.filter((p) => p !== processorId)); const strips = { ...mixer.strips }; delete strips[processorId]; useAppStore.setState({ audioGraph, sequencerInstruments: bindings.filter((b) => b.id !== processorId), mixer: { ...mixer, strips, sends: Object.fromEntries(Object.entries(mixer.sends).filter(([routeId]) => audioGraph.routes.some((r) => r.id === routeId))) } }); }}>×</button></div>)}</details>
      {groups.filter((rs) => rs[0].sourceId === id && rs[0].kind === "send").map((routes) => <div key={routes[0].id} className="mt-2 border-t border-slate-700 pt-2"><span className="text-xs">{t("send")} → {name(routes[0].targetId)}</span><Gain language={language} value={mixer.sends[routes[0].id]?.gainDb ?? null} max={6} label={t("gain")} onChange={(gainDb) => setSend(routes.map((r) => r.id), { gainDb })} onFinal={flush} /><select className={`${field} mt-1 w-full`} value={mixer.sends[routes[0].id]?.tap ?? "post"} onChange={(e) => { setSend(routes.map((r) => r.id), { tap: e.target.value as "pre" | "post" }); flush(); }}><option value="pre">{t("pre")}</option><option value="post">{t("post")}</option></select></div>)}
      <details className="mt-2 text-[10px]"><summary>{t("additional")}</summary>{patch?.audio_interface?.groups.filter((g) => g.direction === "output").map((g) => <div key={g.id}>{g.name}: {g.ports.join(" / ")}</div>)}<div>{outputPorts(patch).join(" / ")}</div></details>
      <button className={`${button} mt-2`} onClick={() => { select(id); open(id); }}>{t("edit")}</button>
      {!master && <button disabled={running} className={`${button} mt-1`} onClick={() => void throughMaster(id)}>{t("routeMaster")}</button>}
    </article>;
  };
  return <details open className="mt-4 rounded-xl border border-slate-700 bg-slate-950/90 p-3 text-slate-200">
    <summary className="cursor-pointer text-sm font-semibold tracking-wide">{t("mixer")}</summary>
    {notice && <div className="my-2 rounded border border-amber-800 p-2 text-xs text-amber-100">{t("migration")} <button className={button} onClick={() => useAppStore.setState({ migrationNotice: false })}>{t("dismiss")}</button></div>}
    {(error || syncError) && <div role="alert" className="my-2 text-xs text-rose-300">{error || syncError}</div>}
    <div className="my-3 flex gap-2 overflow-x-auto pb-2">{bindings.filter((b) => b.id !== graph.masterId && !graph.insertOwners[b.id]).map((b) => strip(b.id))}{graph.masterId ? strip(graph.masterId) : <button className={`${button} h-fit shrink-0`} disabled={running} onClick={() => void useAppStore.getState().ensureMaster().catch((e: unknown) => setError(String(e)))}>{t("createMaster")}</button>}</div>
    <div className="max-w-md text-xs">{t("audioOutput")}<Meter id="$output" name={t("audioOutput")} /></div>
    {running && <button className={button} onClick={onStop}>{t("stop")}</button>}
    <details open className="mt-3 border-t border-slate-800 pt-2"><summary>{t("routing")}</summary>
      <label className="my-2 flex items-center gap-2 text-xs">{t("master")}<select className={field} disabled={running} value={graph.masterId ?? ""} onChange={(e) => applyGraph({ ...graph, masterId: e.target.value || null })}><option value="">—</option>{graph.masterId && !byId.has(graph.masterId) && <option value={graph.masterId}>{name(graph.masterId)}</option>}{bindings.filter((b) => byId.get(b.id)?.has_direct_output).map((b) => <option key={b.id} value={b.id}>{name(b.id)}</option>)}</select></label>
      <div className="my-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs">{t("source")}<select className={field} value={selected} disabled={running} onChange={(e) => { select(e.target.value); setSourcePort(""); }}><option value="">—</option>{bindings.map((b) => <option key={b.id} value={b.id}>{name(b.id)} · {b.id.slice(0, 4)}</option>)}</select></label>
        <label className="flex flex-col text-xs">{t("destination")}<select className={field} value={target} disabled={running} onChange={(e) => { setTarget(e.target.value); setTargetPort(""); }}><option value="">—</option><option value="$output">{t("audioOutput")}</option>{bindings.filter((b) => b.id !== selected && byId.get(b.id)?.audio_inlet_names.length).map((b) => <option key={b.id} value={b.id}>{name(b.id)} · {b.id.slice(0, 4)}</option>)}</select></label>
        <label className="text-xs"><input type="checkbox" checked={stereo} disabled={running} onChange={(e) => setStereo(e.target.checked)} /> Stereo</label>
        {!stereo && <><select aria-label={t("source")} className={field} value={sourcePort} disabled={running} onChange={(e) => setSourcePort(e.target.value)}><option value="">—</option>{outputPorts(byId.get(selected)).map((p) => <option key={p}>{p}</option>)}</select><span>→</span><select aria-label={t("destination")} className={field} value={targetPort} disabled={running} onChange={(e) => setTargetPort(e.target.value)}><option value="">—</option>{(target === "$output" ? ["left", "right"] : byId.get(target)?.audio_inlet_names ?? []).map((p) => <option key={p}>{p}</option>)}</select></>}
        <select aria-label={t("route")} className={field} disabled={running} value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)}><option value="main">{t("main")}</option><option value="send">{t("send")}</option><option value="custom">{t("custom")}</option></select>
        <button className={button} disabled={running || !selected || !target} onClick={add}>{t("add")}</button>
      </div>
      {stereo && selected && target && <p className="mb-2 font-mono text-xs text-cyan-200">{t("mapping")}: {routingGroup(selected, "output")?.ports.join(" / ") ?? "?"} → {target === "$output" ? "left / right" : routingGroup(target, "input")?.ports.join(" / ") ?? "?"}</p>}
      <div className="flex flex-wrap gap-2"><select aria-label={t("inserts")} className={field} value={processor} disabled={running} onChange={(e) => setProcessor(e.target.value)}><option value="">{t("inserts")}…</option>{patches.filter((p) => p.always_on && p.audio_inlet_names.length && p.audio_outlet_names.length).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className={button} disabled={running || !selected || !processor} onClick={insert}>{t("add")}</button></div>
      <details className="mt-3"><summary>{t("matrix")}</summary>{[...new Set([...bindings.map((b) => b.id), ...graph.routes.map((r) => r.targetId)])].map((id) => ({ id })).map((b) => <div key={b.id} className="my-2 rounded border border-slate-800 p-2 text-xs"><button onClick={() => { setTarget(b.id); }}>{name(b.id)}</button>{groups.filter((rs) => rs[0].targetId === b.id).map((routes) => <details key={routes[0].id} className="ml-3"><summary>{name(routes[0].sourceId)} → {name(b.id)} · {routes[0].kind} · {routes.length} ch <button className={button} disabled={running} onClick={() => removeRoutes(routes)}>{t("remove")}</button></summary>{routes.map((r) => <div key={r.id} className="my-1 font-mono"><select aria-label={t("source")} disabled={running} className={field} value={r.sourcePort} onChange={(e) => applyGraph({ ...graph, routes: graph.routes.map((row) => row.id === r.id ? { ...row, sourcePort: e.target.value } : row) })}>{[...new Set([r.sourcePort, ...outputPorts(byId.get(r.sourceId))])].map((p) => <option key={p}>{p}</option>)}</select> → <select aria-label={t("destination")} disabled={running} className={field} value={r.targetId} onChange={(e) => applyGraph({ ...graph, routes: graph.routes.map((row) => row.id === r.id ? { ...row, targetId: e.target.value } : row) })}>{[...new Set([r.targetId, "$output", ...bindings.map((b) => b.id)])].map((id) => <option key={id} value={id}>{name(id)}</option>)}</select> <select aria-label={t("mapping")} disabled={running} className={field} value={r.targetPort} onChange={(e) => applyGraph({ ...graph, routes: graph.routes.map((row) => row.id === r.id ? { ...row, targetPort: e.target.value } : row) })}>{[...new Set([r.targetPort, ...(b.id === "$output" ? ["left", "right"] : r.targetStage === "strip" ? outputPorts(byId.get(b.id)) : byId.get(b.id)?.audio_inlet_names ?? [])])].map((p) => <option key={p}>{p}</option>)}</select></div>)}</details>)}</div>)}</details>
      <details className="mt-3"><summary>{t("diagram")}</summary><div className="flex flex-wrap gap-2 py-2">{groups.map((routes) => <div key={routes[0].id} className="rounded border border-slate-700 p-2 text-xs"><button onClick={() => select(routes[0].sourceId)}>{name(routes[0].sourceId)}</button> → <button onClick={() => { select(routes[0].targetId); setTarget(routes[0].targetId); }}>{name(routes[0].targetId)}</button><details><summary>{t("mapping")}</summary>{routes.map((r) => <div key={r.id}>{r.sourceStage}:{r.sourcePort} → {r.targetStage}:{r.targetPort} <button disabled={running} className={button} onClick={() => removeRoutes([r])}>×</button></div>)}</details></div>)}</div></details>
    </details>
    <details className="mt-3 border-t border-slate-800 pt-2"><summary>{t("diagnostics")}</summary><p className="my-2 text-xs text-slate-400">{t("structural")}</p><button className={button} onClick={() => void check()}>{t("validate")}</button>{[...audioGraphDiagnostics(bindings, patches, graph), ...diagnostics].map((d, i) => <button key={i} className="my-1 block text-left text-xs text-amber-200" onClick={() => { select(d.instanceId ?? ""); if (d.instanceId) open(d.instanceId); }}>{t(d.code in diagnosticKeys ? diagnosticKeys[d.code] : "diagnostics")}: {d.code in diagnosticKeys ? d.instanceId ? name(d.instanceId) : "" : d.message}</button>)}{Object.entries(mixer.strips).filter(([, s]) => s.mute || s.gainDb === null).map(([id]) => <button key={id} className="my-1 block text-xs text-amber-200" onClick={() => select(id)}>{name(id)}: {t("silent")}</button>)}</details>
  </details>;
}
