import type { BrowserClockLatencySettings, SessionMidiEventRequest } from "../types";

export type LiveInputAction = "start" | "stop" | "gesture_start" | "gesture_end";
type Input = { lastActivity: number; notes: Set<string>; sustain: Set<number>; gesture: boolean; held: boolean };

/** Session-only human input state. Sequencer output never enters this policy. */
export class BrowserPlaybackPolicy {
  private inputs = new Map<string, Input>();

  reset(): void { this.inputs.clear(); }

  private touch(source: string, now: number): Input {
    let input = this.inputs.get(source);
    if (!input) {
      input = { lastActivity: now, notes: new Set(), sustain: new Set(), gesture: false, held: false };
      this.inputs.set(source, input);
    }
    input.lastActivity = now;
    return input;
  }

  control(source: string, action: LiveInputAction, now: number): void {
    if (action === "stop") { this.inputs.delete(source); return; }
    if (action === "gesture_end" && !this.inputs.has(source)) return;
    const input = this.touch(source, now);
    if (action !== "start") input.gesture = action === "gesture_start";
  }

  external(activity: boolean, held: boolean, now: number): void {
    if (!activity && !held) { this.inputs.delete("external"); return; }
    this.touch("external", now).held = held;
  }

  midi(midi: SessionMidiEventRequest, source: string, now: number): void {
    if ((midi.type === "note_off" || (midi.type === "note_on" && midi.velocity === 0)) && !this.inputs.has(source)) return;
    // Panic clears every local source on this channel; it is not a new gesture.
    if (midi.type === "all_notes_off" || (midi.type === "control_change" && [120, 123].includes(midi.controller))) {
      for (const [id, input] of this.inputs) {
        for (const note of input.notes) if (note.startsWith(`${midi.channel}:`)) input.notes.delete(note);
        input.sustain.delete(midi.channel);
        if (id !== "external" && !input.notes.size && !input.sustain.size && !input.gesture) this.inputs.delete(id);
      }
      return;
    }
    const input = this.touch(source, now);
    if (midi.type === "note_on" || midi.type === "note_off") {
      const key = `${midi.channel}:${midi.note}`;
      if (midi.type === "note_on" && midi.velocity !== 0) input.notes.add(key);
      else input.notes.delete(key);
    } else if (midi.controller === 64) {
      if (midi.value >= 64) input.sustain.add(midi.channel);
      else input.sustain.delete(midi.channel);
    } else if (midi.controller === 121) {
      input.sustain.delete(midi.channel);
    }
  }

  mode(settings: BrowserClockLatencySettings, now: number): "live" | "listening" {
    if (settings.playbackMode !== "auto") return settings.playbackMode;
    for (const input of this.inputs.values()) {
      if (input.held || input.gesture || input.notes.size || input.sustain.size ||
          now - input.lastActivity < settings.inactivityTimeoutSeconds * 1000) return "live";
    }
    return "listening";
  }
}

/** Preserve advanced Live tuning; Listening adds a minimum reserve without changing synthesis. */
export function playbackLatencySettings(settings: BrowserClockLatencySettings, mode: "live" | "listening"): BrowserClockLatencySettings {
  if (mode === "live") return settings;
  return {
    ...settings,
    steadyLowWaterMs: Math.max(750, settings.steadyLowWaterMs),
    steadyHighWaterMs: Math.max(1500, settings.steadyHighWaterMs),
    startupLowWaterMs: Math.max(1000, settings.startupLowWaterMs),
    startupHighWaterMs: Math.max(1800, settings.startupHighWaterMs),
    maxBlocksPerRequest: 512
  };
}
