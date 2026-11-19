import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { GuiLanguage } from "../../types";
import { ARRANGEMENT_ITEM_MIME, beginArrangementDrag, currentArrangementDrag, endArrangementDrag } from "../../lib/arrangementDrag";
import { livePadNeedsReplacement, livePadHasContent, type LiveDevice } from "../../lib/livePads";
import { useAppStore } from "../../store/useAppStore";
import { arrangementCopy } from "../../lib/arrangementCopy";
import { ArrangerSpeaker } from "./ArrangerSpeaker";
import { usePerformanceEditorState } from "./PerformanceEditorState";
import { liveCopy } from "./liveCopy";

function LaunchPad({ number, editing, sounding, queued, description, onSelect }: {
  number: number; editing: boolean; sounding: boolean; queued: boolean; description: string; onSelect: () => void;
}) {
  const touch = useRef<{ id: number; x: number; y: number } | null>(null);
  const handledTouch = useRef(false);
  return <button type="button" aria-label={`Pad ${number}`} aria-pressed={editing} title={description} aria-description={description}
    data-sounding={sounding || undefined} data-queued={queued || undefined}
    onPointerDown={event => {
      handledTouch.current = false;
      touch.current = event.pointerType === "touch" ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
    }}
    onPointerCancel={() => { touch.current = null; }}
    onPointerUp={event => {
      const start = touch.current;
      if (start?.id !== event.pointerId) return;
      touch.current = null;
      // A second finger on a pad gets pointer events even when the browser omits its click.
      handledTouch.current = true;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 12) onSelect();
    }}
    onClick={event => { if (!handledTouch.current || event.detail === 0) onSelect(); }}>
    {number}<small aria-hidden>{queued ? "◷" : sounding ? "▶" : ""}</small>
  </button>;
}

type Mode = "launch" | "preview" | "actions";
type Transpose = (pad: number, direction: -1 | 1, keyStep: boolean) => void;

function TransposeButton({ label, hint, short, long, direction }: {
  label: string; hint: string; short: () => void; long: () => void; direction: -1 | 1;
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const cancel = () => { clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => {
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("blur", cancel); cancel(); };
  }, []);
  return <button type="button" aria-label={label} title={hint}
    onPointerDown={e => {
      if (e.button !== 0) return;
      cancel();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      timer.current = setTimeout(() => { cancel(); long(); }, 350);
    }}
    onPointerUp={() => { if (timer.current !== undefined) { cancel(); short(); } }}
    onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={cancel}
    onKeyDown={e => { if (e.key === "Escape") cancel(); }}
    onClick={e => { if (e.detail === 0) short(); }}>{direction === -1 ? "↓" : "↑"}</button>;
}

export function LivePadBank({ device, language, editing, sounding, queued, onLaunch, onCopy, onTranspose }: {
  device: LiveDevice; language: GuiLanguage; editing: number; sounding?: number | null; queued?: number | null;
  onLaunch: (pad: number) => void; onCopy: (from: number, to: number) => void; onTranspose?: Transpose;
}) {
  const c = liveCopy(language), a = arrangementCopy(language);
  const owner = `device:${device.id}` as const;
  const [mode, setMode] = usePerformanceEditorState<Mode>(owner, "livePadMode", "launch");
  const [source, setSource] = usePerformanceEditorState(owner, "liveActionPad", editing);
  const [to, setTo] = useState<number | null>(null);
  const [receipt, setReceipt] = useState("");
  const [keyStep, setKeyStep] = useState(false);
  const dragged = useRef(false);
  const contents = useMemo(() => device.pads.map((_, i) => livePadHasContent(device, i)), [device]);
  useEffect(() => () => {
    if (currentArrangementDrag()?.trackId === device.id) endArrangementDrag();
  }, [device.id]);
  const chooseSource = (index: number) => { setSource(index); setTo(null); setReceipt(""); };
  const performCopy = (from: number, target: number) => {
    if (from === target || !device.pads[from] || !device.pads[target]) return;
    try {
      onCopy(from, target);
      setReceipt(`${c("copied")} · ${from + 1} → ${target + 1}`);
      setTo(null);
    } catch (error) { useAppStore.setState({ error: String(error) }); }
  };
  const drop = (event: DragEvent, target: number) => {
    event.preventDefault();
    event.stopPropagation();
    const data = currentArrangementDrag();
    endArrangementDrag();
    if (!data || event.dataTransfer.getData(ARRANGEMENT_ITEM_MIME) !== JSON.stringify(data)) return;
    if (data.trackId !== device.id || data.item.type !== "pad") return;
    const from = data.item.padIndex;
    if (from === target || !Number.isInteger(from) || !device.pads[from]) return;
    chooseSource(from);
    if (livePadNeedsReplacement(device, target)) setTo(target);
    else performCopy(from, target);
  };
  return <div className="ws-live-bank">
    <div className="ws-bank-options"><select aria-label={c("mode")} value={mode} onChange={e => {
      setMode(e.target.value as Mode); chooseSource(editing); endArrangementDrag();
    }}>{(["launch", "preview", "actions"] as const).map(value => <option key={value} value={value}>{c(value)}</option>)}</select><span className="ws-pad-legend"><b>●</b> {c("populated")} · ○ {c("empty")}</span></div>
    <div className="ws-live-pads">{device.pads.map((_, i) => {
      const populated = contents[i];
      const description = [c(populated ? "populated" : "empty"), i === editing && a.editing, i === sounding && a.playing, i === queued && a.queued].filter(Boolean).join(" · ");
      return <div key={i} className="ws-pad-slot" data-populated={populated}
        data-queued={queued === i || undefined} data-sounding={sounding === i || undefined}>
        {mode === "launch" ? <><LaunchPad number={i + 1} editing={i === editing} sounding={i === sounding} queued={i === queued}
          description={description} onSelect={() => onLaunch(i)} /><span className="ws-pad-speaker"><ArrangerSpeaker id={device.id} item={{ type: "pad", padIndex: i }}
            label={`${device.name} · Pad ${i + 1}`} language={language} description={description} /></span></>
          : mode === "preview" ? <ArrangerSpeaker id={device.id} item={{ type: "pad", padIndex: i }}
            label={`${device.name} · Pad ${i + 1}`} language={language} description={description}>{i + 1}</ArrangerSpeaker>
          : <button type="button" draggable aria-label={`${c("actions")} · Pad ${i + 1}`} aria-pressed={i === source}
            aria-description={description} title={description}
            onPointerDown={() => { dragged.current = false; }}
            onClick={e => { if (!dragged.current || e.detail === 0) chooseSource(i); }}
            onDragStart={e => {
              dragged.current = true;
              const item = { type: "pad" as const, padIndex: i };
              beginArrangementDrag(device.id, item);
              e.dataTransfer.setData(ARRANGEMENT_ITEM_MIME, JSON.stringify({ trackId: device.id, item }));
              e.dataTransfer.effectAllowed = "copy";
            }}
            onDragEnd={endArrangementDrag}
            onDragOver={e => { if (currentArrangementDrag()?.trackId === device.id) e.preventDefault(); }}
            onDrop={e => drop(e, i)}>{i + 1}</button>}
      </div>;
    })}</div>
    {mode === "actions" && <div className="ws-pad-tools">
      <strong>Pad {source + 1}</strong>
      <select aria-label={c("copyTo")} value={to ?? ""} onChange={e => { setTo(Number(e.target.value)); setReceipt(""); }}>
        <option value="" disabled>{c("copyTo")}</option>{device.pads.map((_, i) =>
          <option key={i} disabled={i === source} value={i}>Pad {i + 1} · {c(contents[i] ? "populated" : "empty")}</option>)}
      </select>
      {to !== null && <button type="button" onClick={() => performCopy(source, to)}>
        {c(livePadNeedsReplacement(device, to) ? "replace" : "copy")} · {source + 1} → {to + 1}</button>}
      {onTranspose && <><select aria-label={c("transpose")} value={keyStep ? "key" : "scale"} onChange={e => setKeyStep(e.target.value === "key")}>
        <option value="scale">{c("inScale")}</option><option value="key">{c("keyStep")}</option></select>
        {([-1, 1] as const).map(direction => {
          const label = `${c(keyStep ? "keyStep" : "inScale")} · ${c(direction === -1 ? "down" : "up")} · Pad ${source + 1}`;
          return <TransposeButton key={`${source}:${keyStep}:${direction}`} direction={direction} label={label} hint={`${label} · ${c("holdKey")}`}
            short={() => onTranspose(source, direction, keyStep)} long={() => onTranspose(source, direction, true)} />;
        })}</>}
      <span role="status">{receipt}</span>
    </div>}
  </div>;
}
