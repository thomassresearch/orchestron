import type { PatchGraph, PerformanceControllerDefinition, SequencerInstrumentBinding } from "../types";

export const performanceControllerDefaults = { min: 0, max: 1, default: 0.5, scale: "linear" as const, label: "Parameter" };

export function controllerConfigurationError(config: Omit<PerformanceControllerDefinition, "node_id">): string | null {
  if (![config.min, config.max, config.default].every(Number.isFinite)) return "finite";
  if (config.min >= config.max) return "range";
  if (config.default < config.min || config.default > config.max) return "defaultRange";
  if (config.scale !== "linear" && config.scale !== "logarithmic") return "scale";
  if (config.scale === "logarithmic" && config.min <= 0) return "positive";
  if (typeof config.label !== "string" || !config.label.trim() || config.label.length > 128) return "labelRequired";
  return null;
}

export function performanceControllersForGraph(graph: PatchGraph): PerformanceControllerDefinition[] {
  return graph.nodes.filter((node) => node.opcode === "perf_controller").map((node) => {
    const config = { ...performanceControllerDefaults, ...node.params, node_id: node.id } as PerformanceControllerDefinition;
    const error = controllerConfigurationError(config);
    // Invalid imported fields must still produce a safe, disabled rack control.
    return error ? { ...performanceControllerDefaults, node_id: node.id, error } : { ...config, error: null };
  });
}

export function normalizeControllerValues(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
}

export function reconcileControllerValues(binding: SequencerInstrumentBinding, definitions?: PerformanceControllerDefinition[]): SequencerInstrumentBinding {
  const previous = normalizeControllerValues(binding.performanceControllerValues);
  if (!definitions) return { ...binding, performanceControllerValues: previous };
  const byId = new Map(definitions.map((definition) => [definition.node_id, definition]));
  const values = Object.fromEntries(Object.entries(previous).flatMap(([id, value]) => {
    const definition = byId.get(id);
    return definition ? [[id, definition.error ? value : Math.min(definition.max, Math.max(definition.min, value))]] : [];
  }));
  const changed = JSON.stringify(values) !== JSON.stringify(previous);
  return { ...binding, performanceControllerValues: values, performanceControllerNotice: changed || binding.performanceControllerNotice };
}

export function controllerPosition(value: number, definition: PerformanceControllerDefinition): number {
  const clamped = Math.min(definition.max, Math.max(definition.min, value));
  return definition.scale === "logarithmic"
    ? (Math.log(clamped) - Math.log(definition.min)) / (Math.log(definition.max) - Math.log(definition.min))
    : (clamped - definition.min) / (definition.max - definition.min);
}

export function controllerValue(position: number, definition: PerformanceControllerDefinition): number {
  const t = Math.min(1, Math.max(0, position));
  if (t === 0) return definition.min;
  if (t === 1) return definition.max;
  return definition.scale === "logarithmic"
    ? Math.exp(Math.log(definition.min) + t * (Math.log(definition.max) - Math.log(definition.min)))
    : definition.min + t * (definition.max - definition.min);
}

export function controllerTicks(definition: PerformanceControllerDefinition): Array<{ position: number; major: boolean }> {
  if (definition.scale === "linear") return Array.from({ length: 11 }, (_, i) => ({ position: i / 10, major: i % 5 === 0 }));
  const ticks = [{ position: 0, major: true }, { position: 1, major: true }];
  for (let exponent = Math.floor(Math.log10(definition.min)); exponent <= Math.ceil(Math.log10(definition.max)); exponent++) {
    for (let multiplier = 1; multiplier <= 9; multiplier++) {
      const value = multiplier * 10 ** exponent;
      if (value > definition.min && value < definition.max) ticks.push({ position: controllerPosition(value, definition), major: multiplier === 1 });
    }
  }
  // Keep decade marks, thinning intermediate ticks when the range spans many decades.
  return ticks.sort((a, b) => a.position - b.position).filter((tick, i, all) => tick.major || (tick.position - all[i - 1].position > 0.018));
}
