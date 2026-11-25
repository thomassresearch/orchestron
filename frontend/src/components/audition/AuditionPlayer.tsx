import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { auditionCopy } from "../../lib/auditionCopy";
import { pianoRollChordNotes } from "../../lib/pianoRollChord";
import type { GuiLanguage } from "../../types";
import { AuditionKeyboard } from "./AuditionKeyboard";

function pitches(root: number, autoChord: boolean) {
  return autoChord ? pianoRollChordNotes(root, 3, [{ scaleRoot: "C", mode: "ionian" }]) : [root];
}

function soundNotes(notes: number[], pressNote: (note: number) => () => void) {
  const releases = notes.map(pressNote);
  return () => releases.forEach(release => release());
}

export function AuditionPlayer({ initialNote, disabled, language, pressNote, keyboardHost }: {
  initialNote: number; disabled: boolean; language: GuiLanguage;
  pressNote: (note: number) => () => void; keyboardHost?: HTMLDivElement | null;
}) {
  const copy = auditionCopy(language);
  const [autoChord, setAutoChord] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [duration, setDuration] = useState(0.5);
  const [interval, setIntervalSeconds] = useState(1);
  const [lastNotes, setLastNotes] = useState<number[]>([]);
  const [repeatNotes, setRepeatNotes] = useState<number[]>([]);
  const repeat = useRef<{ release: () => void; timer: number } | null>(null);
  const latest = useRef({ pressNote, duration });
  latest.current = { pressNote, duration };

  const releaseRepeat = useCallback(() => {
    if (!repeat.current) return;
    window.clearTimeout(repeat.current.timer);
    repeat.current.release();
    repeat.current = null;
    setRepeatNotes([]);
  }, []);

  useEffect(() => {
    if (!autoplay || disabled || !lastNotes.length) return;
    const timer = window.setInterval(() => {
      releaseRepeat();
      const release = soundNotes(lastNotes, latest.current.pressNote);
      setRepeatNotes(lastNotes);
      repeat.current = { release, timer: window.setTimeout(releaseRepeat, latest.current.duration * 1000) };
    }, interval * 1000);
    return () => { window.clearInterval(timer); releaseRepeat(); };
  }, [autoplay, disabled, interval, lastNotes, releaseRepeat]);

  useEffect(() => {
    if (!autoplay) return;
    const stop = () => setAutoplay(false);
    const onVisibilityChange = () => { if (document.hidden) stop(); };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [autoplay]);

  function playKey(root: number) {
    releaseRepeat();
    const notes = pitches(root, autoChord);
    setLastNotes(notes);
    return { notes, release: soundNotes(notes, pressNote) };
  }

  const locale = { english: "en", german: "de", french: "fr", spanish: "es" }[language];
  const seconds = (value: number) => `${value.toLocaleString(locale)} s`;
  const player = <div className="flex min-w-0 flex-col gap-1.5">
    <fieldset disabled={disabled} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-200 disabled:opacity-40">
      <label className="flex items-center gap-1" title={copy.autoChordHint}>
        <input type="checkbox" checked={autoChord} className="accent-cyan-400" onChange={e => {
          setAutoChord(e.target.checked);
          if (lastNotes.length) setLastNotes(pitches(lastNotes[0], e.target.checked));
        }} />
        {copy.autoChord}
      </label>
      <label className="flex items-center gap-1" title={copy.autoplayHint}>
        <input type="checkbox" checked={autoplay} className="accent-cyan-400" onChange={e => setAutoplay(e.target.checked)} />
        {copy.autoplay}
      </label>
      {autoplay && <>
        <label className="flex items-center gap-1.5">
          {copy.duration}
          <input type="range" aria-label={copy.duration} aria-valuetext={seconds(duration)} min={0.2} max={1} step={0.1}
            value={duration} onChange={e => setDuration(e.target.valueAsNumber)} className="w-16 accent-cyan-400" />
          <span className="w-8 tabular-nums">{seconds(duration)}</span>
        </label>
        <label className="flex items-center gap-1.5" title={copy.intervalHint}>
          {copy.interval}
          <input type="range" aria-label={copy.interval} aria-valuetext={seconds(interval)} min={0.5} max={5} step={0.1}
            value={interval} onChange={e => setIntervalSeconds(e.target.valueAsNumber)} className="w-16 accent-cyan-400" />
          <span className="w-8 tabular-nums">{seconds(interval)}</span>
        </label>
        {!lastNotes.length && <span role="status" className="text-slate-400">{copy.playKey}</span>}
      </>}
    </fieldset>
    <AuditionKeyboard initialNote={initialNote} disabled={disabled} language={language} playKey={playKey} repeatNotes={repeatNotes} />
  </div>;
  return keyboardHost ? createPortal(player, keyboardHost) : player;
}
