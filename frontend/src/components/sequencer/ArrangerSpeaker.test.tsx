// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ArrangerSpeaker } from "./ArrangerSpeaker";
import { PerformanceAuditionContext } from "./PerformanceAudition";
import { cancelArrangerPreviewGestures } from "../../lib/arrangerPreviewGesture";

const audition = vi.fn().mockResolvedValue(undefined);
beforeEach(() => { vi.useFakeTimers(); audition.mockClear(); vi.stubGlobal("PointerEvent", MouseEvent); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() {
  const select = vi.fn();
  const view = render(<PerformanceAuditionContext.Provider value={audition}><div onClick={select} onPointerDown={select}>
    <ArrangerSpeaker id="lane" item={{ type: "pad", padIndex: 1 }} label="2" language="english" />
  </div></PerformanceAuditionContext.Provider>);
  return { ...view, select, speaker: screen.getByRole("button", { name: "Audition 2" }) };
}
it("ignores short clicks, primes audio in the user gesture, and never selects the occurrence", () => {
  const { speaker, select } = setup();
  fireEvent.pointerDown(speaker, { button: 0 });
  act(() => vi.advanceTimersByTime(249));
  fireEvent.pointerUp(speaker); fireEvent.click(speaker);
  act(() => vi.advanceTimersByTime(1000));
  expect(audition).toHaveBeenCalledExactlyOnceWith("lane", expect.objectContaining({ action: "preview_arm" }));
  expect(select).not.toHaveBeenCalled();
});
it.each(["pointerUp", "pointerCancel", "lostPointerCapture", "blur"] as const)("ends the matching hold on %s without waiting for its start response", event => {
  const { speaker } = setup();
  audition.mockImplementationOnce(async () => {}).mockImplementationOnce(() => new Promise(() => {}));
  fireEvent.pointerDown(speaker, { button: 0 });
  act(() => vi.advanceTimersByTime(250));
  const request = audition.mock.calls[1][1];
  expect(request).toMatchObject({ action: "preview_start", item: { type: "pad", padIndex: 1 } });
  fireEvent[event](speaker);
  expect(audition).toHaveBeenLastCalledWith("lane", { action: "preview_end", gestureId: request.gestureId });
  fireEvent.pointerUp(speaker);
  expect(audition).toHaveBeenCalledTimes(3);
});
it("supports keyboard hold/release and cancels on unmount", () => {
  const { speaker, unmount } = setup();
  fireEvent.keyDown(speaker, { key: " " });
  act(() => vi.advanceTimersByTime(250));
  fireEvent.keyUp(speaker, { key: " " });
  expect(audition.mock.calls[2][1].action).toBe("preview_end");
  fireEvent.keyDown(speaker, { key: "Enter" });
  act(() => vi.advanceTimersByTime(250));
  unmount();
  expect(audition.mock.calls[5][1].action).toBe("preview_end");
});
it("transport cancellation also clears the initial hold delay", () => {
  const { speaker } = setup();
  fireEvent.pointerDown(speaker, { button: 0 });
  act(() => { vi.advanceTimersByTime(100); cancelArrangerPreviewGestures(); vi.advanceTimersByTime(1000); });
  expect(audition).toHaveBeenCalledExactlyOnceWith("lane", expect.objectContaining({ action: "preview_arm" }));
  expect(speaker.getAttribute("aria-pressed")).toBe("false");
});
