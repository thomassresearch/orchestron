import { usePerformanceEditorState } from "./PerformanceEditorState";
import { useEffect, useId, useRef } from "react";
import { performanceDeviceNameCopy } from "../../lib/performanceDeviceNameCopy";
import {
  performanceDeviceDisplayName, validatePerformanceDeviceName,
  type PerformanceDeviceKind, type PerformanceDeviceNameError, type RenamePerformanceDevice
} from "../../lib/performanceDeviceNames";
import type { GuiLanguage, SequencerState } from "../../types";

interface Props {
  kind: PerformanceDeviceKind;
  device: { id: string; name: string };
  fallback: string;
  sequencer: SequencerState;
  guiLanguage: GuiLanguage;
  onRename: RenamePerformanceDevice;
}

export function PerformanceDeviceName({ kind, device, fallback, sequencer, guiLanguage, onRename }: Props) {
  const copy = performanceDeviceNameCopy[guiLanguage];
  const name = performanceDeviceDisplayName(device.name, fallback);
  const [editing, setEditing] = usePerformanceEditorState(`device:${device.id}`, `nameEditing:${kind}`, false);
  const [draft, setDraft] = usePerformanceEditorState(`device:${device.id}`, `nameDraft:${kind}`, device.name);
  const [saveError, setSaveError] = usePerformanceEditorState<PerformanceDeviceNameError | null>(`device:${device.id}`, `nameError:${kind}`, null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const validation = validatePerformanceDeviceName(sequencer, kind, device.id, draft);
  const error = validation.ok ? saveError : validation.error;

  const previousEditing = useRef(editing);
  const focusFrame = useRef<number | null>(null);
  useEffect(() => () => { if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current); }, []);
  useEffect(() => {
    if (editing && !previousEditing.current) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    previousEditing.current = editing;
  }, [editing]);

  const close = () => {
    setEditing(false);
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => { focusFrame.current = null; buttonRef.current?.focus(); });
  };
  const save = () => {
    if (!validation.ok) return;
    const result = onRename(kind, device.id, draft);
    if (result.ok) close();
    else setSaveError(result.error);
  };
  const buttonClass = "shrink-0 rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:border-accent focus-visible:outline focus-visible:outline-accent disabled:opacity-40";

  return (
    <div className="min-w-0 max-w-full text-xs text-slate-200">
      <div hidden={editing} className={`${editing ? "hidden" : "flex"} min-w-0 items-center gap-1.5`}>
        <span className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">{name}</span>
        <button ref={buttonRef} type="button" className={buttonClass} title={copy.edit}
          aria-label={`${copy.edit}: ${name}`} onClick={() => {
            setDraft(device.name); setSaveError(null); setEditing(true);
          }}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="m16 3 5 5-12 12-6 1 1-6L16 3Z M13 6l5 5" />
          </svg>
        </button>
      </div>
      {editing ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
        <label className="sr-only" htmlFor={inputId}>{copy.label}</label>
        <input ref={inputRef} id={inputId} type="text" value={draft}
          className="min-w-0 w-64 max-w-full rounded border border-slate-500 bg-slate-950 px-2 py-1 text-sm"
          aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
          onChange={(event) => { setDraft(event.target.value); setSaveError(null); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
            if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); save(); }
          }} />
        <button type="button" className={buttonClass} disabled={Boolean(error)} onClick={save}>{copy.save}</button>
        <button type="button" className={buttonClass} onClick={close}>{copy.cancel}</button>
        {error ? <p id={errorId} role="alert" className="w-full text-rose-300">{copy.errors[error]}</p> : null}
      </div> : null}
    </div>
  );
}
