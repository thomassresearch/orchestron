// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../../backend/tests/fixtures/performances/arranger_seek.json";
import { useAppStore } from "../../store/useAppStore";
import { ArrangerHistoryControls } from "./ArrangerHistoryControls";

function edit(padIndex: number) {
  const s = useAppStore.getState(), track = s.sequencer.tracks[0];
  s.commitArrangerEdit("place", [{ id: track.id, kind: "sequencer", pattern: { ...track.padLoopPattern, rootSequence: [{ type: "pad", padIndex }] } }]);
}
const cursor = () => useAppStore.getState().arrangerHistory.cursor;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("PointerEvent", MouseEvent);
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("disables empty history and performs one step on a short click", () => {
  render(<ArrangerHistoryControls language="english" collapsed={false} />);
  const undo = screen.getByRole("button", { name: "Undo" }), redo = screen.getByRole("button", { name: "Redo" });
  expect((undo as HTMLButtonElement).disabled).toBe(true);
  expect((redo as HTMLButtonElement).disabled).toBe(true);
  act(() => edit(2));
  fireEvent.pointerDown(undo, { button: 0 }); act(() => vi.advanceTimersByTime(499));
  fireEvent.pointerUp(undo); fireEvent.click(undo);
  expect(cursor()).toBe(0); expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(redo); expect(cursor()).toBe(1);
});

it("holds without stepping, suppresses release-click and jumps inclusively through past/future", () => {
  edit(2); edit(3); edit(4);
  render(<ArrangerHistoryControls language="english" collapsed={false} />);
  const undo = screen.getByRole("button", { name: "Undo" });
  fireEvent.pointerDown(undo, { button: 0 }); act(() => vi.advanceTimersByTime(500));
  expect(screen.getByRole("menu", { name: "Undo history" })).toBeTruthy();
  expect(cursor()).toBe(3);
  fireEvent.pointerUp(undo); fireEvent.click(undo); expect(cursor()).toBe(3);
  const entries = screen.getAllByRole("menuitem");
  expect(entries).toHaveLength(3);
  fireEvent.click(entries[2]); expect(cursor()).toBe(0);
  expect(screen.queryByRole("menu")).toBeNull();
  const redo = screen.getByRole("button", { name: "Redo" });
  fireEvent.keyDown(redo, { key: "ArrowDown" });
  expect(screen.getByRole("menu", { name: "Redo history" })).toBeTruthy();
  fireEvent.click(screen.getAllByRole("menuitem")[1]); expect(cursor()).toBe(2);
});

it.each(["movement", "cancel", "leave", "blur"])("cancels a pending hold on %s", reason => {
  edit(2); render(<ArrangerHistoryControls language="english" collapsed={false} />);
  const undo = screen.getByRole("button", { name: "Undo" });
  fireEvent.pointerDown(undo, { button: 0, clientX: 10, clientY: 10 });
  if (reason === "movement") fireEvent.pointerMove(undo, { clientX: 16, clientY: 10 });
  if (reason === "cancel") fireEvent.pointerCancel(undo);
  if (reason === "leave") fireEvent.pointerLeave(undo);
  if (reason === "blur") fireEvent.blur(window);
  act(() => vi.advanceTimersByTime(600));
  fireEvent.pointerUp(undo); fireEvent.click(undo);
  expect(screen.queryByRole("menu")).toBeNull(); expect(cursor()).toBe(1);
});

it("closes menus on Escape, collapse, navigation, and performance replacement", () => {
  edit(2);
  const view = render(<ArrangerHistoryControls language="english" collapsed={false} />);
  const undo = screen.getByRole("button", { name: "Undo" });
  const open = () => fireEvent.keyDown(undo, { key: "ArrowDown" });
  open(); fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull(); expect(document.activeElement).toBe(undo);
  open(); view.rerender(<ArrangerHistoryControls language="english" collapsed />); expect(screen.queryByRole("menu")).toBeNull();
  open(); act(() => useAppStore.getState().setActivePage("sequencer")); expect(screen.queryByRole("menu")).toBeNull();
  open(); act(() => useAppStore.getState().applySequencerConfigSnapshot(fixture.config)); expect(screen.queryByRole("menu")).toBeNull();
});

it.each(["german", "french", "spanish"] as const)("provides translated controls and history in %s", language => {
  edit(2); render(<ArrangerHistoryControls language={language} collapsed={false} />);
  const undo = screen.getAllByRole("button")[0];
  expect(undo.getAttribute("aria-label")).not.toBe("Undo");
  fireEvent.keyDown(undo, { key: "ArrowDown" });
  expect(screen.getByRole("menuitem").textContent).not.toContain("Place ·");
});
