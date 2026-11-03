import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage } from "../../types";
import { CassetteIcon } from "../sequencer/CassetteIcon";
import { clipCopy } from "./copy";

export function ClipTransport({ language, copy, onPlay, onPause, onStop, onRewind, onForward }: {
  language: GuiLanguage;
  copy: { transportRewind: string; transportPlay: string; transportStop: string; transportFastForward: string };
  onPlay: () => void; onPause: () => void; onStop: () => void; onRewind: () => void; onForward: () => void;
}) {
  const playing = useAppStore(s => s.sequencerRuntime.arrangerActive === true);
  const position = useAppStore(s => s.sequencerRuntime.arrangerTransportSubunit ?? 0);
  const start = useAppStore(s => (s.sequencer.arrangerLoopSelection?.startStep ?? 0) * 2520);
  const actions = [
    { kind: "rewind", label: copy.transportRewind, run: onRewind },
    { kind: "play", label: copy.transportPlay, run: onPlay, active: playing },
    { kind: "pause", label: clipCopy(language).pause, run: onPause, active: !playing && position !== start },
    { kind: "stop", label: copy.transportStop, run: onStop, active: !playing && position === start },
    { kind: "fastForward", label: copy.transportFastForward, run: onForward }
  ] as const;
  return <div className="flex items-center gap-1.5">{actions.map(action => <button key={action.kind} type="button"
    title={action.label} aria-label={action.label} aria-pressed={"active" in action ? action.active : undefined}
    onClick={action.run} className={"inline-flex h-8 w-8 items-center justify-center rounded-md border border-amber-400/50 bg-amber-400/10 text-amber-100 transition hover:bg-amber-400/20" + ("active" in action && action.active ? " ring-2 ring-amber-300 !bg-amber-300 !text-slate-950" : "")}>
    <CassetteIcon kind={action.kind} />
  </button>)}</div>;
}
