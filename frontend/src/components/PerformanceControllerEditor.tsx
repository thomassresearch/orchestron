import { useState } from "react";
import { controllerConfigurationError, controllerDefaults } from "../lib/performanceControllers";
import { performanceControllerCopy } from "../lib/performanceControllerCopy";
import type { GuiLanguage, NodeInstance, PerformanceControllerType } from "../types";
import { NodeEditorModalFrame } from "./NodeEditorModalFrame";

export function PerformanceControllerEditor({ node, language, onClose, onSave }: {
  node: NodeInstance; language: GuiLanguage; onClose: () => void; onSave: (params: NodeInstance["params"]) => void;
}) {
  const copy = performanceControllerCopy(language);
  const [fields, setFields] = useState(() => Object.fromEntries(Object.entries({ ...controllerDefaults(node.params.controller_type as PerformanceControllerType | undefined), ...node.params }).map(([key, value]) => [key, String(value)])));
  const config = { controller_type: fields.controller_type as PerformanceControllerType,
    min: fields.min.trim() ? Number(fields.min) : NaN, max: fields.max.trim() ? Number(fields.max) : NaN,
    default: fields.default.trim() ? Number(fields.default) : NaN,
    scale: fields.scale as "linear" | "logarithmic", label: fields.label };
  const error = controllerConfigurationError(config);
  const changeType = (controllerType: PerformanceControllerType) => {
    const next: Record<string, string> = { ...fields, controller_type: controllerType };
    if (controllerType !== "float") next.scale = "linear";
    if (controllerType === "integer") {
      for (const key of ["min", "max", "default"] as const) {
        if (fields[key].trim() && Number.isFinite(Number(fields[key]))) next[key] = String(Math.round(Number(fields[key])));
      }
    } else if (controllerType === "bool") {
      next.min = "0";
      next.max = "1";
      next.default = Number(fields.default) >= 0.5 ? "1" : "0";
    }
    setFields(next);
  };
  const fieldClass = "w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100";
  return <NodeEditorModalFrame ariaLabel={copy.configure} title={`perf_controller · ${copy.title}`} nodeId={node.id} nodeLabel={copy.node}
    closeLabel={copy.close} onClose={onClose} maxWidthClassName="max-w-lg"
    footer={<button className="rounded border border-cyan-500 bg-cyan-950 px-4 py-2 text-cyan-100 disabled:opacity-40" disabled={!!error}
      onClick={() => { onSave(config); onClose(); }}>{copy.save}</button>}>
    <div className="grid grid-cols-2 gap-3">
      <label className="col-span-2 text-xs text-slate-300">{copy.label}<input autoFocus className={fieldClass} maxLength={128} value={fields.label}
        onChange={(event) => setFields({ ...fields, label: event.target.value })} /></label>
      <label className="col-span-2 text-xs text-slate-300">{copy.type}<select className={fieldClass} value={fields.controller_type}
        onChange={(event) => changeType(event.target.value as PerformanceControllerType)}>
        <option value="float">{copy.float}</option><option value="integer">{copy.integer}</option><option value="bool">{copy.bool}</option>
      </select></label>
      {config.controller_type === "bool" ? <label className="col-span-2 text-xs text-slate-300">{copy.default}<select className={fieldClass} value={fields.default}
        onChange={(event) => setFields({ ...fields, default: event.target.value })}>
        <option value="0">{copy.off}</option><option value="1">{copy.on}</option>
      </select></label> : (["min", "max", "default"] as const).map((key) => <label key={key} className="text-xs text-slate-300">{copy[key]}
        <input type="number" step={config.controller_type === "integer" ? 1 : "any"} className={fieldClass} value={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />
      </label>)}
      {config.controller_type === "float" && <label className="text-xs text-slate-300">{copy.scale}<select className={fieldClass} value={fields.scale}
        onChange={(event) => setFields({ ...fields, scale: event.target.value })}>
        <option value="linear">{copy.linear}</option><option value="logarithmic">{copy.logarithmic}</option>
      </select></label>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-rose-300">{copy[error as keyof typeof copy] ?? copy.invalid}</p>}
    <p className="mt-3 text-xs text-slate-400">{config.controller_type === "float" ? copy.help : config.controller_type === "integer" ? copy.integerHelp : copy.boolHelp} {copy.continuous}</p>
  </NodeEditorModalFrame>;
}
