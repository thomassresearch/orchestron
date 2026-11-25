import { api } from "../api/client";
import type { PatchGraph } from "../types";
import { FM6, FM6_GLOBALS } from "./fm6";

export type Fm6PreviewValues = Record<string, Record<string, number>>;
const defaults: Record<string, number> = { ...FM6.default, ipreset: 0,
  ...Object.fromEntries(Object.entries(FM6_GLOBALS).map(([key, range]) => [key, range[2]])) };

/** Send one complete node snapshot at a time. A rollback can replace a pending slider movement. */
export class Fm6Audition {
  private wanted: Fm6PreviewValues = Object.create(null);
  private confirmed: Fm6PreviewValues;
  private work?: Promise<void>;

  constructor(private session: string, readonly initial: Fm6PreviewValues) {
    this.confirmed = { ...initial };
  }

  read(graph: PatchGraph) {
    for (const node of graph.nodes) {
      if (node.opcode !== "fm6_voice" || !Object.prototype.hasOwnProperty.call(this.initial, node.id)) continue;
      const next: Record<string, number> = {};
      for (const key of Object.keys(this.initial[node.id])) {
        const value = Number(node.params[key] ?? defaults[key]);
        if (!Number.isFinite(value)) continue;
        next[key] = value;
      }
      this.wanted[node.id] = next;
    }
  }

  flush(): Promise<void> {
    // All callers, including the keyboard, wait for the same sequence of writes.
    this.work ??= this.sendChanges().finally(() => { this.work = undefined; });
    return this.work;
  }

  private async sendChanges(): Promise<void> {
    while (true) {
      const changed = Object.entries(this.wanted).find(([node, values]) =>
        Object.entries(values).some(([key, value]) => this.confirmed[node]?.[key] !== value));
      if (!changed) return;
      const [node, values] = changed;
      try {
        await api.updateFm6Preview(this.session, node, values);
        this.confirmed[node] = values;
      } catch (error) {
        // An interrupted response can arrive after the engine accepted the change.
        delete this.confirmed[node];
        throw error;
      }
    }
  }
}
