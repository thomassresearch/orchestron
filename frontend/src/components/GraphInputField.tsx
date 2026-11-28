import { useState } from "react";
import { inputValueCopy } from "../lib/inputValueCopy";
import { instrumentDesignCopy } from "../lib/instrumentDesignCopy";
import { numericInputLiteral, validateInputValue, type InputValueState } from "../lib/inputValue";
import type { GuiLanguage, PortSpec } from "../types";

interface Props {
  language: GuiLanguage;
  port: PortSpec;
  state: InputValueState;
  unit?: string;
  save: (value: string) => void;
  openFormula: () => void;
}

export function GraphInputField({ language, port, state, unit, save, openFormula }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? state.expression;
  const literal = state.source !== "formula" && !state.bindings.length &&
    (state.mode === "string" || !state.expression || numericInputLiteral(state.expression) !== null);
  const validation = validateInputValue(state, value);
  const valid = validation.isValid && (state.mode === "string" || numericInputLiteral(value) !== null);
  const labels = inputValueCopy(language);
  const error = validation.error === "presetRange" ? labels.presetRange : validation.error === "releaseRange" ? labels.releaseRange : labels.numberError;
  const commit = () => {
    if (draft !== null && draft !== state.expression && valid) save(draft);
    setDraft(null);
  };
  return <span className="graph-input-field" onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    <span title={port.description || port.name}>{port.name.replace(/([a-z])([A-Z])/g, "$1 $2")}</span>
    {literal && <label>
      <input aria-label={port.name} value={value} placeholder="—" aria-invalid={draft !== null && !valid}
        title={draft !== null && !valid ? error : port.description} onChange={e => setDraft(e.target.value)}
        onBlur={commit} onKeyDown={e => {
          e.stopPropagation();
          if (e.key === "Enter" && valid) e.currentTarget.blur();
          if (e.key === "Escape") { e.preventDefault(); setDraft(null); }
        }} />
      {unit && <small>{unit}</small>}
    </label>}
    <button type="button" title={instrumentDesignCopy(language).editFormula} aria-label={instrumentDesignCopy(language).editFormula + " · " + port.name}
      onClick={openFormula}>ƒx</button>
  </span>;
}
