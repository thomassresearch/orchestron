import { useState } from "react";
import { controllerConfigurationError, performanceControllerDefaults } from "../lib/performanceControllers";
import { performanceControllerCopy } from "../lib/performanceControllerCopy";
import type { GuiLanguage, NodeInstance } from "../types";
import { NodeEditorModalFrame } from "./NodeEditorModalFrame";

export function PerformanceControllerEditor({ node, language, onClose, onSave }: {
  node: NodeInstance; language: GuiLanguage; onClose: () => void; onSave: (params: NodeInstance["params"]) => void;
}) {
  const copy = performanceControllerCopy(language);
  const [fields, setFields] = useState(() => Object.fromEntries(Object.entries({ ...performanceControllerDefaults, ...node.params }).map(([key, value]) => [key, String(value)])));
  const config = { min: fields.min.trim() ? Number(fields.min) : NaN, max: fields.max.trim() ? Number(fields.max) : NaN,
    default: fields.default.trim() ? Number(fields.default) : NaN,
    scale: fields.scale as "linear" | "logarithmic", label: fields.label };
  const error = controllerConfigurationError(config);
  const fieldClass = "w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100";
  return <NodeEditorModalFrame ariaLabel={copy.configure} title={`perf_controller · ${copy.title}`} nodeId={node.id} nodeLabel={copy.node}
    closeLabel={copy.close} onClose={onClose} maxWidthClassName="max-w-lg"
    footer={<button className="rounded border border-cyan-500 bg-cyan-950 px-4 py-2 text-cyan-100 disabled:opacity-40" disabled={!!error}
      onClick={() => { onSave(config); onClose(); }}>{copy.save}</button>}>
    <div className="grid grid-cols-2 gap-3">
      <label className="col-span-2 text-xs text-slate-300">{copy.label}<input autoFocus className={fieldClass} maxLength={128} value={fields.label}
        onChange={(event) => setFields({ ...fields, label: event.target.value })} /></label>
      {(["min", "max", "default"] as const).map((key) => <label key={key} className="text-xs text-slate-300">{copy[key]}
        <input type="number" step="any" className={fieldClass} value={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />
      </label>)}
      <label className="text-xs text-slate-300">{copy.scale}<select className={fieldClass} value={fields.scale}
        onChange={(event) => setFields({ ...fields, scale: event.target.value })}>
        <option value="linear">{copy.linear}</option><option value="logarithmic">{copy.logarithmic}</option>
      </select></label>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-rose-300">{copy[error as keyof typeof copy] ?? copy.invalid}</p>}
    <p className="mt-3 text-xs text-slate-400">{copy.help} {copy.continuous}</p>
  </NodeEditorModalFrame>;
}
