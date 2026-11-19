import { useEffect, useState } from "react";
import type { BrowserClockWorkerDiagnostics } from "../audio/browserClockWorkerProtocol";
import { api } from "../api/client";
import { ENGINE_STATS_COPY } from "../lib/engineStatsCopy";
import { useAppStore } from "../store/useAppStore";
import type { EngineStats } from "../types";

export function cpuLoadColor(percent: number | null): string {
  if (percent === null) return "text-slate-400";
  if (percent <= 50) return "text-emerald-400";
  return percent <= 85 ? "text-orange-400" : "text-red-400";
}

function BufferMeter({ data, label, underruns }: {
  data?: BrowserClockWorkerDiagnostics | null; label: string; underruns: string;
}) {
  let fill: number | null = null;
  let depth = "—";
  let level = "idle";
  if (data && data.highWaterFrames > 0 && data.sampleRate > 0) {
    const { queuedFrames, lowWaterFrames, highWaterFrames, sampleRate } = data;
    fill = Math.min(1, queuedFrames / highWaterFrames);
    const ms = (frames: number) => Math.round(frames * 1000 / sampleRate);
    depth = `${ms(queuedFrames)} / ${ms(highWaterFrames)} ms`;
    if (queuedFrames === 0 || queuedFrames < lowWaterFrames) level = "low";
    else level = queuedFrames < (lowWaterFrames + highWaterFrames) / 2 ? "mid" : "high";
  }
  const percent = fill === null ? null : Math.round(fill * 100);
  return <span className="engine-buffer" title={data ? `${label} · ${depth} · ${underruns} ${data.underrunCount}` : label}>
    {label}
    <span className="buffer-leds" data-level={level} role={percent === null ? "img" : "meter"} aria-label={label}
      aria-valuemin={percent === null ? undefined : 0} aria-valuemax={percent === null ? undefined : 100}
      aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? undefined : `${percent}% · ${depth}`}>
      {Array.from({ length: 12 }, (_, i) => <i key={i} data-lit={fill !== null && i < Math.ceil(fill * 12) || undefined} />)}
    </span>
    <span>{depth}</span>
    {data && <span>{underruns} {data.underrunCount}</span>}
  </span>;
}

export function EngineStatusLine({ embedded = false, diagnostics }: {
  embedded?: boolean; diagnostics?: BrowserClockWorkerDiagnostics | null;
} = {}) {
  const language = useAppStore(s => s.guiLanguage);
  const sessionId = useAppStore(s => s.activeSessionId);
  const state = useAppStore(s => s.activeSessionState);
  const loading = useAppStore(s => s.loading);
  const enabled = useAppStore(s => s.parallelPlaybackEnabled);
  const setEnabled = useAppStore(s => s.setParallelPlaybackEnabled);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const copy = ENGINE_STATS_COPY[language];

  useEffect(() => {
    setStats(null);
    if (!sessionId) return;
    let cancelled = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      if (cancelled || pending || document.hidden) return;
      pending = true;
      controller = new AbortController();
      try {
        const next = await api.getEngineStats(sessionId, controller.signal);
        if (!cancelled && !document.hidden && next.session_id === sessionId) setStats(next);
      } catch {
        if (!cancelled) setStats(null);
      } finally {
        pending = false;
        if (!cancelled && !document.hidden && state === "running") timer = setTimeout(() => { void poll(); }, 1000);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (document.hidden) controller?.abort();
      else void poll();
    };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [sessionId, state]);

  const current = stats?.session_id === sessionId ? stats : null;
  const running = state === "running" && current?.state === "running";
  const renderer = current?.renderer;
  const selection = !current && state === "running" ? copy.pending : renderer?.selected === "parallel" ? `${copy.parallel} (${renderer.worker_count})`
    : renderer?.fallback_reason === "parallel_disabled" ? copy.disabled
    : renderer?.fallback_reason ? copy.fallback : copy.single;
  const value = (percent: number | null) => <span className={`inline-block min-w-[6ch] text-right ${cpuLoadColor(percent)}`}>{percent === null ? "—" : `${Number(percent.toFixed(1))}%`}</span>;

  const Container = embedded ? "div" : "footer";
  return <Container role={embedded ? "group" : undefined} aria-label={copy.title}
    className={`engine-status ${embedded ? "engine-status-embedded" : "fixed inset-x-0 bottom-0 z-50 border-t border-slate-700 bg-slate-950 px-3 py-1"}`}>
    <span className="shrink-0 font-semibold">{copy.title}</span>
    <span className="shrink-0">{state !== "running" && !renderer ? copy.stopped : selection}</span>
    <span className="engine-cpus tabular-nums" title={copy.cpuHelp}
      tabIndex={running && current.scope === "renderer_cpus" && current.cpus.length > 1 ? 0 : undefined}>
      {running && current?.available && current.scope === "renderer_cpus"
        ? current.cpus.map(cpu => <span key={cpu.cpu}>cpu{cpu.cpu}: {value(cpu.percent)}</span>)
        : running && current?.available && current.scope === "server_process"
          ? <span>{copy.process}: {value(current.process_percent)}</span>
          : state === "running" ? <span className="text-slate-500">{copy.unavailable}</span> : null}
    </span>
    <BufferMeter data={state === "running" ? diagnostics : null} label={copy.buffer} underruns={copy.underruns} />
    <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 font-body" title={copy.optInHelp}>
      <input type="checkbox" checked={enabled} disabled={state === "running" || loading}
        onChange={event => setEnabled(event.target.checked)} className="accent-emerald-400 disabled:cursor-not-allowed" />
      {copy.optIn}
    </label>
  </Container>;
}
