import { useRef, useState } from "react";

/** Transport follows playback until the user starts editing a seek destination. */
export function PositionInput({ beats, className, onSeek }: {
  beats: number; className: string; onSeek: (step: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const dirty = useRef(false);
  const displayed = String(Math.round(beats * 100) / 100);
  return <input className={className} type="number" min={0} step={0.25} value={draft ?? displayed}
    onFocus={() => { dirty.current = false; setDraft(displayed); }}
    onChange={event => { dirty.current = true; setDraft(event.target.value); }}
    onBlur={event => {
      const text = event.target.value, value = Number(text);
      const commit = dirty.current && text.trim() !== "" && Number.isFinite(value) && value >= 0;
      dirty.current = false;
      setDraft(null);
      if (commit) onSeek(Math.round(value * 8));
    }}
    onKeyDown={event => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") dirty.current = false;
      event.currentTarget.blur();
    }} />;
}
