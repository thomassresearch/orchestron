import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SequencerConfigSync } from "./sequencerConfigSync";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("sequencer authored edit synchronization", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not resubmit Start or repeated playback snapshots", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const sync = new SequencerConfigSync(send, vi.fn(), vi.fn());
    sync.baseline("session", 4);
    for (let tick = 0; tick < 1000; tick++) {
      sync.edit("session", 4, { tick });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("debounces edits, keeps one request in flight, and applies only the latest result", async () => {
    const first = deferred<string>();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("latest");
    const applied = vi.fn();
    const sync = new SequencerConfigSync(send, applied, vi.fn());
    sync.baseline("session", 0);
    sync.edit("session", 1, "first");
    await vi.advanceTimersByTimeAsync(79);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    sync.edit("session", 2, "discard");
    sync.edit("session", 3, "latest");
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(1);
    first.resolve("stale");
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls).toEqual([["session", "first"], ["session", "latest"]]);
    expect(applied.mock.calls).toEqual([["latest"]]);
  });

  it.each(["stop", "replacement"])("ignores in-flight results after %s", async kind => {
    const pending = deferred<string>();
    const applied = vi.fn();
    const failed = vi.fn();
    const sync = new SequencerConfigSync(() => pending.promise, applied, failed);
    sync.baseline("session", 0);
    sync.edit("session", 1, "edit");
    await vi.advanceTimersByTimeAsync(80);
    if (kind === "stop") sync.stop();
    else sync.baseline("new-session", 1);
    pending.resolve("old");
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it("reports a failure once and retries only for a new authored revision", async () => {
    const send = vi.fn().mockRejectedValue(new Error("compiler unavailable"));
    const failed = vi.fn();
    const sync = new SequencerConfigSync(send, vi.fn(), failed);
    sync.baseline("session", 0);
    sync.edit("session", 1, "edit");
    await vi.advanceTimersByTimeAsync(1000);
    sync.edit("session", 1, "same edit");
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(1);
    sync.edit("session", 2, "next edit");
    await vi.advanceTimersByTimeAsync(80);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
