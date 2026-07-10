import type { AudibleBrowserClockTransportEvent } from "./browserClockWorkerProtocol";

export function unsignedCounterDistance(current: number, previous: number): number {
  return (current - previous) >>> 0;
}

export function availableRingFrames(readCounter: number, writeCounter: number, capacityFrames: number): number {
  const available = unsignedCounterDistance(writeCounter >>> 0, readCounter >>> 0);
  return available <= Math.max(0, capacityFrames) ? available : 0;
}

export function mapSourceSampleToTargetFrame(
  engineSample: number,
  engineSampleStart: number,
  engineSampleEnd: number,
  targetFrameCount: number
): number {
  const sourceFrames = Math.max(1, Math.round(engineSampleEnd) - Math.round(engineSampleStart));
  const targetFrames = Math.max(1, Math.round(targetFrameCount));
  const sourceOffset = Math.max(0, Math.min(sourceFrames, Math.round(engineSample) - Math.round(engineSampleStart)));
  return Math.max(0, Math.min(targetFrames, Math.round((sourceOffset * targetFrames) / sourceFrames)));
}

export function coalesceAudibleTransportEvents(
  events: AudibleBrowserClockTransportEvent[]
): AudibleBrowserClockTransportEvent[] {
  let lastStepIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].kind === "step") {
      lastStepIndex = index;
      break;
    }
  }
  return events.filter((event, index) => event.kind !== "step" || index === lastStepIndex);
}
