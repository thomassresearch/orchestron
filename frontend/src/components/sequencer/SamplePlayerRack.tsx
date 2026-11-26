import { auditionCopy } from "../../lib/auditionCopy";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api } from "../../api/client";
import { useSamplePreview } from "../../hooks/useSamplePreview";
import { sampleCopy } from "../../lib/sampleCopy";
import { midiNoteLabel } from "../../lib/sequencer";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage, SampleMap, SequencerInstrumentBinding } from "../../types";
import { EditorDetails, usePerformanceEditorState, useRetainedScroll } from "./PerformanceEditorState";

const action = "rounded border border-slate-600 px-2 py-1 text-xs text-slate-100 hover:border-cyan-500 focus-visible:outline-cyan-300 disabled:opacity-40";
const number = "w-16 rounded border border-slate-600 bg-slate-950 px-1 py-1 text-xs tabular-nums disabled:opacity-60";

type RackProps = { binding: SequencerInstrumentBinding; label: string; capable: boolean; language: GuiLanguage; running: boolean };

export function SamplePlayerRack(props: RackProps) {
  const { binding, capable, label, language } = props;
  const copy = sampleCopy(language);
  const [open, setOpen] = usePerformanceEditorState(`binding:${binding.id}`, `samples-open:${binding.patchId}`, false);
  return <section className="mt-2 min-w-0 border-t border-slate-700 pt-2" aria-label={`${copy.title} — ${label}`}>
    <button type="button" className={action} aria-expanded={open} onClick={() => setOpen(!open)}>
      {copy.title} · {binding.sampleMap?.entries.length ?? 0}
    </button>
    {!capable && <p className="mt-2 text-xs text-amber-200">{copy.incompatible}</p>}
    {open && <SampleMapEditor {...props} />}
  </section>;
}

export function SampleMapEditor({ binding, capable, label, language, running }: RackProps) {
  const copy = sampleCopy(language);
  const owner = `binding:${binding.id}` as const;
  const [selected, select] = usePerformanceEditorState<number | null>(owner, `samples-row:${binding.patchId}`, null);
  const [newNote, setNewNote] = usePerformanceEditorState(owner, `samples-new-note:${binding.patchId}`, "36");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const pickedNote = useRef<{ note: number; replace: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const rows = useRef<HTMLUListElement>(null);
  const saveScroll = useRetainedScroll(rows, owner, `samples-scroll:${binding.patchId}`);
  const preview = useSamplePreview(binding, err => setError(err instanceof Error ? err.message : String(err)));
  const entries = binding.sampleMap?.entries ?? [];
  const current = entries.find(row => row.note === selected);
  const selectedSample = current && binding.sampleAssets?.[current.assetId];
  const preparing = useAppStore(state => state.loading);
  const readOnly = running || preparing || busy || preview.playing;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; upload.current?.abort(); };
  }, []);
  useEffect(() => { if (running && upload.current) upload.current.abort(); }, [running]);

  function report(error: unknown) {
    setError(error instanceof Error ? error.message : String(error));
  }

  function mutate(next: SampleMap["entries"] | undefined) {
    setError(null);
    const state = useAppStore.getState();
    try {
      state.applySampleMap(binding, state.performanceWorkspaceGeneration,
        next ? { version: 1, entries: next } : undefined, binding.sampleAssets ?? {});
      return true;
    } catch (error) { report(error); return false; }
  }

  function choose(raw: string, replace: boolean) {
    setError(null);
    const note = Number(raw);
    if (!raw.trim() || !Number.isInteger(note) || note < 0 || note > 127) { setError(copy.range); return; }
    if (!replace && entries.some(row => row.note === note)) { setError(copy.collision); return; }
    pickedNote.current = { note, replace };
    file.current?.click();
  }

  async function assign(event: ChangeEvent<HTMLInputElement>) {
    const source = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    const target = pickedNote.current;
    pickedNote.current = null;
    if (!source || !target || upload.current || readOnly) return;
    const start = useAppStore.getState();
    if (start.activeSessionState === "running" || start.loading || start.sequencerInstruments.find(row => row.id === binding.id)?.patchId !== binding.patchId) {
      setError(copy.lock); return;
    }
    const cancel = new AbortController();
    upload.current = cancel;
    useAppStore.setState(state => ({ sampleUploads: state.sampleUploads + 1 }));
    setBusy(true);
    try {
      const result = await api.uploadSample(source, cancel.signal);
      if (cancel.signal.aborted) return;
      const next = entries.filter(row => row.note !== target.note).concat({ note: target.note, assetId: result.asset_id });
      useAppStore.getState().applySampleMap(binding, start.performanceWorkspaceGeneration, { version: 1, entries: next },
        { ...binding.sampleAssets, [result.asset_id]: result.asset });
      select(target.note);
      if (!target.replace) {
        const free = Array.from({ length: 128 }, (_, i) => (target.note + i + 1) % 128).find(note => !next.some(row => row.note === note));
        if (free !== undefined) setNewNote(String(free));
      }
    } catch (error) { if (!cancel.signal.aborted) report(error); }
    finally {
      upload.current = null;
      useAppStore.setState(state => ({ sampleUploads: Math.max(0, state.sampleUploads - 1) }));
      if (alive.current) setBusy(false);
    }
  }

  function changeNote(from: number, field: HTMLInputElement) {
    const to = Number(field.value);
    if (!field.value || !Number.isInteger(to) || to < 0 || to > 127) { setError(copy.range); }
    else if (to === from) return;
    else if (entries.some(row => row.note === to)) setError(copy.collision);
    else if (mutate(entries.map(row => row.note === from ? { ...row, note: to } : row))) { select(to); return; }
    field.value = String(from);
  }

  return <div className="mt-2 space-y-2 rounded-md bg-slate-950/60 p-2 text-xs" data-sample-map>
    <p className="font-semibold text-cyan-100">{label}</p>
    <EditorDetails owner={owner} field={`samples-help:${binding.patchId}`} className="text-slate-300"
      summary={copy.info} summaryClassName="cursor-pointer focus-visible:outline-cyan-300">
      {() => <p className="mt-1 leading-relaxed">{copy.help}</p>}
    </EditorDetails>
    {running && <p role="status" className="text-amber-200">{copy.lock}</p>}
    {entries.length === 0 && <p className="text-slate-300">{copy.noMap}</p>}
    <input ref={file} type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4,audio/x-m4a" className="hidden" onChange={event => void assign(event)} />
    <ul ref={rows} onScroll={saveScroll} className="max-h-72 space-y-1 overflow-auto" aria-label={copy.title}>
      {entries.map(row => {
        const asset = binding.sampleAssets?.[row.assetId];
        return <li key={row.note} className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded border p-1.5 ${selected === row.note ? "border-cyan-500 bg-cyan-950/40" : "border-slate-700"}`}>
          <button type="button" className={action} aria-pressed={selected === row.note}
            disabled={preview.playing} onClick={() => { setError(null); select(row.note); }}>{row.note} · {midiNoteLabel(row.note, false)}</button>
          <input type="number" min={0} max={127} step={1} defaultValue={row.note} className={number}
            aria-label={`${copy.note} ${row.note}`} disabled={readOnly || !capable}
            onBlur={event => changeNote(row.note, event.currentTarget)}
            onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-2 [@container(max-width:430px)]:basis-full">
            <span className="min-w-0 break-all text-slate-100">{asset?.source.original_name ?? row.assetId}</span>
            {asset && <span className="whitespace-nowrap text-slate-400">{asset.playback.frameCount < 48 ? "< 0.001" : (asset.playback.frameCount / asset.playback.sampleRate).toFixed(3)} s · {asset.playback.channels === 1 ? copy.mono : copy.stereo}</span>}
          </div>
          <button type="button" className={action} onClick={() => choose(String(row.note), true)}
            aria-label={`${copy.replace}: ${row.note}`} disabled={readOnly || !capable}>{copy.replace}</button>
          <button type="button" className={action} onClick={() => mutate(entries.filter(entry => entry.note !== row.note))}
            aria-label={`${copy.remove}: ${row.note}`} disabled={readOnly}>{copy.remove}</button>
        </li>;
      })}
    </ul>
    <div className="flex flex-wrap items-center gap-1.5">
      {capable && <><label className="flex items-center gap-1.5">
        {copy.note}<input type="number" min={0} max={127} step={1} className={number} disabled={readOnly}
          value={newNote} onChange={event => setNewNote(event.target.value)} />
      </label>
      <button type="button" className={action} disabled={readOnly} onClick={() => choose(newNote, false)}>{copy.add}</button>
      <button type="button" className={action} disabled={busy || preview.stopping || (!preview.playing && !selectedSample)}
        onClick={() => {
          setError(null);
          if (preview.playing) void preview.stop();
          else if (current && selectedSample) preview.start(current.note, selectedSample.playback.frameCount / selectedSample.playback.sampleRate);
        }}>{preview.stopping ? auditionCopy(language).stopping : preview.playing ? copy.stopPreview : copy.preview}</button>
      </>}
      {entries.length > 0 && <button type="button" className={action} disabled={readOnly}
        onClick={() => { if (mutate(undefined)) select(null); }}>{copy.clear}</button>}
    </div>
    {busy && <div role="status" className="flex flex-wrap items-center gap-2 text-cyan-200">
      {copy.busy}<button type="button" className={action} onClick={() => { upload.current?.abort(); setBusy(false); }}>{copy.cancel}</button>
    </div>}
    {error && <p role="alert" className="break-words text-rose-300">{error}</p>}
  </div>;
}
