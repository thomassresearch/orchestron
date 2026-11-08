import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ENGINE_STATS_COPY } from "../lib/engineStatsCopy";
import { useAppStore } from "../store/useAppStore";
import type { EngineStats } from "../types";

export function cpuLoadColor(percent: number | null): string {
  if (percent === null) return "text-slate-400";
  if (percent <= 50) return "text-emerald-400";
  return percent <= 85 ? "text-orange-400" : "text-red-400";
}

export function EngineStatusLine() {
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

  return <footer aria-label={copy.title} className="fixed inset-x-0 bottom-0 z-50 flex h-7 items-center gap-3 overflow-x-auto whitespace-nowrap border-t border-slate-700 bg-slate-950 px-4 font-mono text-[11px] text-slate-300 shadow-lg sm:px-6 lg:px-8">
    <span className="shrink-0 font-semibold">{copy.title}</span>
    <span className="shrink-0">{selection}{state !== "running" ? ` · ${copy.stopped}` : ""}</span>
    <span className="flex shrink-0 gap-3 tabular-nums" title={copy.cpuHelp}>
      {running && current?.available && current.scope === "renderer_cpus"
        ? current.cpus.map(cpu => <span key={cpu.cpu}>cpu{cpu.cpu}: {value(cpu.percent)}</span>)
        : running && current?.available && current.scope === "server_process"
          ? <span>{copy.process}: {value(current.process_percent)}</span>
          : state === "running" ? <span className="text-slate-500">{copy.unavailable}</span> : null}
    </span>
    <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 font-body" title={copy.optInHelp}>
      <input type="checkbox" checked={enabled} disabled={state === "running" || loading}
        onChange={event => setEnabled(event.target.checked)} className="accent-emerald-400 disabled:cursor-not-allowed" />
      {copy.optIn}
    </label>
  </footer>;
}
