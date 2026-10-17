import { audioCopy } from "../lib/audioCopy";
import type { AudioDiagnostic, AudioRoutingEndpoint, GuiLanguage } from "../types";

export function MixerFeedbackDiagnostics({ diagnostics, language, onShow }: {
  diagnostics: AudioDiagnostic[];
  language: GuiLanguage;
  onShow: () => void;
}) {
  const t = audioCopy(language);
  const endpoint = (point: AudioRoutingEndpoint) => <span className="min-w-0">
    <span className="font-semibold">{point.id === "$master" ? t("master") : point.name}</span>
    {point.midiChannel > 0 && <span> · {t("midiChannelShort")} {point.midiChannel}</span>}
    <span className="text-rose-200/80"> · {t(point.stage === "raw" ? "rawStage" : point.stage === "strip" ? "stripStage" : "inputStage")}</span>
    <span className="block break-all font-mono text-[10px] text-rose-200/70">{point.id}</span>
  </span>;
  if (!diagnostics.length) return null;
  return <section role="alert" className="my-3 rounded-lg border border-rose-500 bg-rose-950/30 p-3 text-xs text-rose-100">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong>{t("feedback")}</strong>
      <button className="rounded border border-rose-400 px-2 py-1 hover:bg-rose-900" onClick={onShow}>{t("showFeedback")}</button>
    </div>
    <p className="my-2 text-rose-200">{t("feedbackHelp")}</p>
    {diagnostics.map((diagnostic, index) => <div key={index} className="mt-3">
      <div className="mb-1 font-semibold">{t("feedbackPath")} {index + 1} · {diagnostic.routeIds?.length ?? 0} {t("channelConnections")}</div>
      {diagnostic.routingPath?.length ? <ol className="space-y-1">{diagnostic.routingPath.map((step, stepIndex) => <li key={stepIndex} className="grid gap-1 rounded bg-slate-950/50 p-2 sm:grid-cols-[1fr_auto_1fr] sm:gap-4">
        {endpoint(step.source)}
        <span className="self-center text-center text-rose-200">{t(step.kind === "insert" ? "inserts" : step.kind)}<br /><span className="font-mono">{step.source.ports.join(" / ")} → {step.target.ports.join(" / ")}</span></span>
        {endpoint(step.target)}
      </li>)}</ol> : <p>{diagnostic.message}</p>}
    </div>)}
  </section>;
}
