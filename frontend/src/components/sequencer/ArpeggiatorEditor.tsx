import { patternPadClass } from "../../lib/patternItemPresentation";
import { PerformanceAuditionControls, usePerformanceAudition } from "./PerformanceAudition";
import { useAppStore } from "../../store/useAppStore";
import { useId, useRef, type ReactNode } from "react";
import type { ArpeggiatorCommand, ArpeggiatorPadState, ArpeggiatorPresetState, ArpeggiatorState, ArpeggiatorStep, GuiLanguage, PatchListItem, SequencerInstrumentBinding } from "../../types";
import { ARPEGGIATOR_PATTERNS, ARPEGGIATOR_RATES, normalizeArpeggiatorSettings } from "../../store/appStoreModel";
import { PadLoopPatternEditor } from "./PadLoopPatternEditor";
import { usePerformanceEditorState } from "./PerformanceEditorState";
import { arpeggiatorCopy } from "./arpeggiatorCopy";
import type { SequencerUiCopy } from "./sequencerUiCopy";
import { scaleDegreeBorderBackground } from "../../lib/scaleDegreeColors";

const field = "min-w-0 rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm text-slate-100";
const button = "rounded-md border border-slate-600 px-2 py-1 text-xs hover:border-cyan-300 disabled:opacity-40";
const noteName = (note: number) => `${["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][note % 12]}${Math.floor(note / 12) - 1}`;

type Props = {
  arp: ArpeggiatorState; language: GuiLanguage; ui: SequencerUiCopy; name: ReactNode; help: ReactNode;
  presets: ArpeggiatorPresetState[]; instruments: SequencerInstrumentBinding[]; patches: PatchListItem[];
  canRemove: boolean; engineRunning: boolean; transportPlaying: boolean; stepsPerBeat: number;
  onChange: (update: Partial<ArpeggiatorState>) => void;
  onEnabled: (enabled: boolean) => void; onRemove: () => void;
  onCommand: (command: ArpeggiatorCommand) => void;
  onPreset: (id: string, pad: number) => void;
  onSave: (name: string, pad: number, update?: boolean) => void;
};

export function ArpeggiatorEditor({ arp, language, ui, name, help, presets, instruments, patches, canRemove,
  engineRunning, transportPlaying, stepsPerBeat, onChange, onEnabled, onRemove, onCommand, onPreset, onSave }: Props) {
  const audition = usePerformanceAudition();
  const c = arpeggiatorCopy(language);
  const owner = `device:${arp.id}` as const;
  const editingPad = useAppStore(state => state.sequencerEditingPads[arp.id] ?? arp.activePad);
  const setEditingPad = (pad: number) => useAppStore.getState().selectSequencerEditingPad(arp.id, pad);
  const [selection, setSelection] = usePerformanceEditorState(owner, "arpStep", 0);
  const [draft, setDraft] = usePerformanceEditorState(owner, "arpPresetDraft", "");
  const [expanded, setExpanded] = usePerformanceEditorState<Record<string, boolean>>(owner, "arpExpanded", {});
  const [linked, setLinked] = usePerformanceEditorState<number | null>(owner, "arpLinked", null);
  const gridRef = useRef<HTMLDivElement>(null);
  const previewId = useId();
  const pad = arp.pads[editingPad];
  const stepIndex = Math.min(selection, pad.steps.length - 1);
  const step = pad.steps[stepIndex];
  const runtime = arp.runtimeStatus;
  const playingPad = runtime?.active_pad ?? arp.activePad;
  const presetId = arp.padPresetIds[editingPad];
  const preset = presets.find(p => p.id === presetId);
  const modified = !!preset && JSON.stringify(normalizeArpeggiatorSettings(preset.settings)) !== JSON.stringify(normalizeArpeggiatorSettings(pad));
  const targets = instruments.filter(i => i.midiChannel > 0 && i.midiChannel !== arp.inputChannel);
  const hasTarget = targets.some(i => i.midiChannel === arp.targetChannel);
  const state = !engineRunning || !arp.enabled ? "stopped" : runtime?.state ?? (arp.playbackMode === "arranger" ? "waiting_arranger" : "waiting_notes");
  const updatePad = (update: Partial<ArpeggiatorPadState>) => onChange({ pads: arp.pads.map((p, i) => i === editingPad ? normalizeArpeggiatorSettings({ ...p, ...update }) : p) });
  const updateStep = (update: Partial<ArpeggiatorStep>) => updatePad({ steps: pad.steps.map((s, i) => i === stepIndex ? { ...s, ...update } : s) });
  const select = (label: string, value: string, options: Array<[string, string]>, change: (value: string) => void) => <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-300">{label}<select className={field} value={value} onChange={e => change(e.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
  const number = (label: string, value: number, min: number, max: number, change: (value: number) => void) => <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-300">{label}<input className={field} type="number" min={min} max={max} value={value} onChange={e => { if (e.target.value !== "") change(Math.max(min, Math.min(max, Number(e.target.value)))); }} /></label>;
  const section = (key: keyof typeof c, children: ReactNode) => <details className="rounded-lg border border-slate-700 p-2" open={expanded[key] ?? false} onToggle={e => { const open = e.currentTarget.open; if (open !== !!expanded[key]) setExpanded(v => ({ ...v, [key]: open })); }}><summary className="cursor-pointer text-xs font-semibold text-slate-300">{c[key]}</summary><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{children}</div></details>;
  return <article id={`sequencer-${arp.id}`} className="min-w-0 space-y-3 rounded-xl border border-slate-700 bg-slate-900/65 p-3">
    <header className="flex flex-wrap items-center gap-2">{name}<span role="status" className="rounded-full border border-cyan-900 px-2 py-1 text-xs text-cyan-100">{hasTarget ? c[state] : c.missing}</span>
      <button className={button} onClick={() => onEnabled(!engineRunning || !arp.enabled)}>{engineRunning && arp.enabled ? ui.stop : ui.start}</button>
      <button className={`${button} ml-auto text-rose-200`} disabled={!canRemove} onClick={onRemove}>{ui.remove}</button>{help}</header>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,2fr)] items-end gap-2 sm:col-span-2 lg:col-span-3">
        {number(ui.inputChannel, arp.inputChannel, 1, 16, v => onChange({ inputChannel: v }))}
        <span aria-hidden="true" className="pb-1.5 text-lg leading-5 text-slate-400">→</span>
        {select(ui.targetChannel, String(arp.targetChannel), [[String(arp.targetChannel), hasTarget ? `${arp.targetChannel} · ${targets.filter(i => i.midiChannel === arp.targetChannel).map(i => patches.find(p => p.id === i.patchId)?.name ?? i.patchId).join(" + ")}` : `${arp.targetChannel} · ${c.missing}`], ...targets.filter(i => i.midiChannel !== arp.targetChannel).map(i => [String(i.midiChannel), `${i.midiChannel} · ${patches.find(p => p.id === i.patchId)?.name ?? i.patchId}`] as [string, string])], value => onChange({ targetChannel: Number(value) }))}
      </div>
      {select(c.playback, arp.playbackMode, [["arranger", c.arranger], ["live", c.live]], v => onChange({ playbackMode: v as ArpeggiatorState["playbackMode"] }))}
      {select(c.active, arp.processingMode, [["active", c.active], ["bypass", c.bypass], ["mute", c.mute]], v => onChange({ processingMode: v as ArpeggiatorState["processingMode"] }))}
      {select(c.hold, arp.holdMode, [["off", c.off], ["replace", c.replace], ["toggle", c.toggle]], v => onChange({ holdMode: v as ArpeggiatorState["holdMode"] }))}
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs"><span>{ui.heldNotes}: <span className="font-mono text-cyan-100">{arp.heldNotes.map(noteName).join(" ") || "—"}</span></span><span>{ui.activeNote}: {(runtime?.active_notes ?? (arp.activeNote === null ? [] : [arp.activeNote])).map(noteName).join(" ") || "—"}</span><button className={`${button} ml-auto`} onClick={() => onCommand({ command: "clear" })}>{c.clear}</button></div>
    <div className="flex gap-1" aria-label={c.editing}>{arp.pads.map((_, i) => <div key={i} className={`flex flex-1 rounded-lg border ${patternPadClass(editingPad === i, runtime?.queued_pad === i)}`}>
      <button draggable className="min-w-0 flex-1 px-1 py-2 text-xs" aria-label={`${c.editing} #${i + 1}`} aria-pressed={editingPad === i} onClick={() => { setEditingPad(i); setSelection(0); }}
        onDragStart={e => { e.dataTransfer.setData("application/x-visualcsound-sequencer-pad", JSON.stringify({ trackId: arp.id, padIndex: i })); }}
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); try { const data = JSON.parse(e.dataTransfer.getData("application/x-visualcsound-sequencer-pad")) as { trackId: string; padIndex: number }; if (data.trackId === arp.id && arp.pads[data.padIndex]) onChange({ pads: arp.pads.map((p, n) => n === i ? normalizeArpeggiatorSettings(arp.pads[data.padIndex]) : p) }); } catch { /* Ignore unrelated drags. */ } }}>
        #{i + 1}{arp.enabled && playingPad === i ? " ●" : ""}{runtime?.queued_pad === i ? " ◷" : ""}</button>
      <button className="border-l border-slate-600 px-1 text-cyan-200" aria-label={`${c.launch} #${i + 1}`} onClick={() => arp.playbackMode === "arranger" && audition ? void audition(arp.id, { type: "pad", padIndex: i }) : onCommand({ command: "launch", pad_index: i })}>▶</button></div>)}</div>
    <p className="text-[11px] text-slate-400">{c.hint}</p>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {select(ui.preset, presetId ?? "", [["", ui.preset], ...presets.map(p => [p.id, p.name] as [string, string])], v => { if (v) onPreset(v, editingPad); })}
      {select(ui.rate, pad.rate, ARPEGGIATOR_RATES.map(v => [v, v]), v => updatePad({ rate: v as ArpeggiatorPadState["rate"] }))}
      {select(ui.pattern, pad.pattern, ARPEGGIATOR_PATTERNS.map(v => [v, ui.arpeggiatorPatternLabels[v]]), v => updatePad({ pattern: v as ArpeggiatorPadState["pattern"] }))}
      {number(ui.octaves, pad.octaves, 1, 4, v => updatePad({ octaves: v }))}
      {number(`${ui.gate} (%)`, Math.round(pad.gateRatio * 100), 5, 200, v => updatePad({ gateRatio: v / 100 }))}
      {number(`${ui.swing} (%)`, Math.round(pad.swing * 100), 0, 75, v => updatePad({ swing: v / 100 }))}
      {number(c.cycle, pad.steps.length, 1, 32, v => updatePad({ steps: Array.from({ length: v }, (_, i) => pad.steps[i] ?? { kind: "next", notePosition: 1, velocity: 100, gateRatio: null, probability: 1, ratchets: 1 }) }))}
      {select(c.duration, String(pad.lengthBeats), [1, 2, 3, 4, 5, 6, 7, 8, 16].map(v => [String(v), String(v)]), v => updatePad({ lengthBeats: Number(v) as ArpeggiatorPadState["lengthBeats"] }))}
    </div>
    <div ref={gridRef} role="group" aria-label={c.cycle} className="grid gap-1 overflow-x-auto rounded-lg bg-slate-950 p-2" style={{ gridTemplateColumns: `repeat(${pad.steps.length}, minmax(56px, 1fr))` }}>
      {pad.steps.map((s, i) => {
        const notes = playingPad === editingPad && s.kind !== "rest" && s.kind !== "tie" ? runtime?.preview_notes?.[i] ?? [] : [];
        const reportedDegrees = runtime?.preview_degrees?.[i];
        const degrees = pad.scaleMode !== "off" && reportedDegrees?.length === notes.length
          ? reportedDegrees.filter((degree): degree is number => degree !== null && Number.isInteger(degree) && degree >= 1 && degree <= 7) : [];
        const noteLabels = notes.map(noteName).join(" ");
        const description = notes.length ? `${c.previewNotes}: ${noteLabels}${degrees.length ? `; ${c.scaleDegrees}: ${[...new Set(degrees)].sort((a, b) => a - b).join(", ")}` : ""}` : undefined;
        const borderBackground = scaleDegreeBorderBackground(degrees);
        return <div key={i} className={`relative flex h-32 min-w-0 flex-col rounded border-2 border-slate-700 ${stepIndex === i ? "outline outline-2 outline-offset-1 outline-cyan-200" : ""} ${playingPad === editingPad && arp.enabled && runtime?.state === "playing" && arp.stepIndex === i ? "bg-cyan-900/70" : "bg-slate-900"}`}>
        {borderBackground ? <span aria-hidden="true" className="pointer-events-none absolute -inset-0.5 rounded-[inherit] p-0.5" style={{ background: borderBackground, mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)", maskComposite: "exclude" }} /> : null}
        <button className="flex min-h-0 min-w-0 flex-1 flex-col justify-between rounded-sm p-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white" aria-label={`${c.step} ${i + 1}: ${c[s.kind]}`} aria-describedby={description ? `${previewId}-${i}` : undefined} title={description} aria-pressed={stepIndex === i} onClick={() => setSelection(i)} onDoubleClick={() => updatePad({ steps: pad.steps.map((entry, j) => j === i ? { ...entry, kind: entry.kind === "rest" ? "next" : "rest" } : entry) })}
          onKeyDown={e => { const kinds: Record<string, ArpeggiatorStep["kind"]> = { " ": s.kind === "rest" ? "next" : "rest", Delete: "rest", Backspace: "rest", t: "tie", c: "chord", n: "next" }; if (e.key in kinds) { e.preventDefault(); setSelection(i); updatePad({ steps: pad.steps.map((entry, j) => j === i ? { ...entry, kind: kinds[e.key] } : entry) }); } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const next = (i + (e.key === "ArrowRight" ? 1 : -1) + pad.steps.length) % pad.steps.length; setSelection(next); gridRef.current?.querySelectorAll("button")[next]?.focus(); } }}>
          <span className="text-slate-400">{i + 1}</span><span>{s.kind === "next" ? "↑" : s.kind === "position" ? s.notePosition : s.kind === "rest" ? "·" : s.kind === "tie" ? "—" : "≡"}</span>
          <span className="w-full truncate text-center text-[18px] leading-6 text-cyan-200">{noteLabels}</span></button>
        {description ? <span id={`${previewId}-${i}`} className="sr-only">{description}</span> : null}
        <input type="range" min={0} max={200} step={1} value={s.velocity} aria-label={`${c.velocity} ${i + 1}`} className="h-10 w-full accent-cyan-300" style={{ writingMode: "vertical-lr", direction: "rtl" }} onChange={e => updatePad({ steps: pad.steps.map((entry, j) => j === i ? { ...entry, velocity: Number(e.target.value) } : entry) })} />
      </div>; })}
    </div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
      {select(`${c.step} ${stepIndex + 1}`, step.kind, ["next", "position", "rest", "tie", "chord"].map(v => [v, c[v as ArpeggiatorStep["kind"]]]), v => updateStep({ kind: v as ArpeggiatorStep["kind"] }))}
      {step.kind === "position" ? number(c.position, step.notePosition, 1, 128, v => updateStep({ notePosition: v })) : null}
      {number(c.velocity, step.velocity, 0, 200, v => updateStep({ velocity: v }))}
      {number(`${ui.probability} (%)`, Math.round(step.probability * 100), 0, 100, v => updateStep({ probability: v / 100 }))}
      {number(c.ratchets, step.ratchets, 1, 4, v => updateStep({ ratchets: v }))}
      {number(`${ui.gate} (%)`, Math.round((step.gateRatio ?? pad.gateRatio) * 100), 5, 200, v => updateStep({ gateRatio: v / 100 }))}
      <button className={button} onClick={() => updateStep({ gateRatio: null })}>{c.inherit}</button>
    </div>
    <div className="flex flex-wrap gap-2">{runtime?.queued_pad !== null && runtime?.queued_pad !== undefined ? <button className={button} onClick={() => onCommand({ command: "cancel" })}>{c.cancel} P{runtime.queued_pad + 1}</button> : null}{runtime?.manual_override ? <button className={button} onClick={() => onCommand({ command: "arrangement" })}>{c.return}</button> : null}</div>
    {section("expression", <>
      {select(ui.velocityMode, pad.velocityMode, ["input", "fixed", "random"].map(v => [v, ui.arpeggiatorVelocityModeLabels[v as "input" | "fixed" | "random"]]), v => updatePad({ velocityMode: v as ArpeggiatorPadState["velocityMode"] }))}
      {pad.velocityMode !== "input" ? number(ui.fixedVelocity, pad.fixedVelocity, 1, 127, v => updatePad({ fixedVelocity: v })) : null}
      {number(`${ui.humanizeMs} (ms)`, pad.humanizeMs, 0, 50, v => updatePad({ humanizeMs: v }))}
      {number(ui.humanizeVelocity, pad.humanizeVelocity, 0, 32, v => updatePad({ humanizeVelocity: v }))}
      {select(c.randomMode, pad.randomMode, [["repeat", c.repeat], ["evolve", c.evolve]], v => updatePad({ randomMode: v as "repeat" | "evolve" }))}
      {number(c.seed, pad.randomSeed, 0, 2147483647, v => updatePad({ randomSeed: v }))}
      <button className={button} onClick={() => updatePad({ randomSeed: (pad.randomSeed + 104729) % 2147483648 })}>{c.newVariation}</button>
    </>)}
    {section("harmony", <>
      {number(`${ui.transpose} (st)`, pad.transpose, -24, 24, v => updatePad({ transpose: v }))}
      {select(ui.scale, pad.scaleMode, [["off", c.off], ["source", c.source], ["custom", c.custom]], v => updatePad({ scaleMode: v as ArpeggiatorPadState["scaleMode"] }))}
      {pad.scaleMode !== "off" ? <>{select(ui.scale, pad.scaleRoot, ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"].map(v => [v, v]), v => updatePad({ scaleRoot: v as ArpeggiatorPadState["scaleRoot"] }))}
        {select(ui.mode, pad.mode, ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"].map(v => [v, v]), v => updatePad({ mode: v as ArpeggiatorPadState["mode"] }))}<span className="text-xs">{c.effective}: {runtime?.effective_scale ?? "—"}</span></> : null}
    </>)}
    {section("advanced", <>
      {select(ui.restartMode, arp.restartMode, ["free", "first_note", "beat", "bar"].map(v => [v, ui.arpeggiatorRestartModeLabels[v as ArpeggiatorState["restartMode"]]]), v => onChange({ restartMode: v as ArpeggiatorState["restartMode"] }))}
      {select(c.launch, arp.launchQuantize, [["cycle", c.nextCycle], ["bar", c.nextBar]], v => onChange({ launchQuantize: v as "cycle" | "bar" }))}
      {select(c.traversal, pad.octaveTraversal, [["range", c.range], ["octave", c.octave]], v => updatePad({ octaveTraversal: v as "range" | "octave" }))}
      {number(c.repeats, pad.repeats, 1, 4, v => updatePad({ repeats: v }))}
      {number(c.rotation, pad.rotation, 0, pad.steps.length - 1, v => updatePad({ rotation: v }))}
      <label className="text-xs"><input type="checkbox" checked={pad.advanceRests} onChange={e => updatePad({ advanceRests: e.target.checked })} /> {c.advance}</label>
    </>)}
    <div className="flex flex-wrap items-center gap-2"><label className="flex-1 text-xs">{c.saveAs}<input className={`${field} ml-2`} value={draft} placeholder={ui.presetNamePlaceholder} onChange={e => setDraft(e.target.value)} /></label><span className="text-xs text-amber-200">{modified ? c.modified : ""}</span><button className={button} disabled={!preset || preset.builtin || !modified} onClick={() => { if (preset) onSave(preset.name, editingPad, true); }}>{c.update}</button><button className={button} disabled={!draft.trim()} onClick={() => { onSave(draft, editingPad); setDraft(""); }}>{c.saveAs}</button></div>
    {arp.playbackMode === "arranger" && <PerformanceAuditionControls id={arp.id} language={language} editingPad={editingPad} playingPad={playingPad} playing={transportPlaying} item={{ type: "pad", padIndex: editingPad }} />}
    <PadLoopPatternEditor hideSource={arp.playbackMode === "live"} allowAudition={arp.playbackMode === "arranger"} ui={ui} guiLanguage={language} hostId={arp.id} track={{ ...arp, padLoopPosition: runtime?.pad_loop_position ?? null }} stepsPerBeat={stepsPerBeat} padStepCounts={arp.pads.map(p => p.lengthBeats * stepsPerBeat)} defaultPadStepCount={4 * stepsPerBeat} isPlaying={transportPlaying && arp.playbackMode === "arranger"} linkedPadLoopStepPosition={linked} onLinkedPadLoopStepPositionChange={setLinked} onPadLoopEnabledChange={v => onChange({ padLoopEnabled: v })} onPadLoopRepeatChange={v => onChange({ padLoopRepeat: v })} onPadLoopPatternChange={v => onChange({ padLoopPattern: v })} />
  </article>;
}
