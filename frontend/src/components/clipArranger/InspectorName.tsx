import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { EditScope } from "../../lib/clipArranger/relationships";

type Props = {
  label: string;
  renameLabel: string;
  name: string;
  detail?: string;
  scope?: EditScope | null;
  chooseScope?: (choose: (scope: EditScope) => void, cancel: () => void) => ReactNode;
  onSave: (name: string, scope: EditScope) => void;
};

export function InspectorName({ label, renameLabel, name, detail, scope = "all", chooseScope, onSave }: Props) {
  // undefined is idle, null awaits a scope choice, and a scope opens the text field.
  const [editing, setEditing] = useState<EditScope | null>();
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const cancel = useRef(false);
  const valueId = useId();

  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (restoreFocus.current) {
      button.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);

  return <div className="flex w-full min-w-0 flex-col items-start gap-1">
    <span>{label}{detail && ` · ${detail}`}</span>
    {editing ? <input ref={input} aria-label={label} maxLength={128} defaultValue={name}
      className="w-full min-w-0 rounded border border-cyan-600 bg-slate-950 px-2 py-1 text-slate-100"
      onBlur={event => {
        const value = event.currentTarget.value.trim();
        setEditing(undefined);
        if (!cancel.current && value && value !== name) onSave(value, editing);
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || (event.key !== "Escape" && event.key !== "Enter")) return;
        event.preventDefault();
        event.stopPropagation();
        cancel.current = event.key === "Escape";
        restoreFocus.current = true;
        event.currentTarget.blur();
      }} /> :
      <button ref={button} type="button" aria-label={renameLabel} aria-describedby={valueId} title={renameLabel}
        className="flex max-w-full items-center gap-1.5 rounded text-left font-medium text-cyan-200 hover:text-cyan-100 focus-visible:outline focus-visible:outline-cyan-300"
        onClick={() => { cancel.current = false; setEditing(scope); }}>
        <span id={valueId} className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
        <span aria-hidden="true" className="shrink-0 text-sm">✎</span>
      </button>}
    {editing === null && chooseScope?.(setEditing, () => setEditing(undefined))}
  </div>;
}
