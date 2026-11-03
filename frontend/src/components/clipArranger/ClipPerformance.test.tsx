// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { migrateClipArrangement } from "../../lib/clipArranger/migration";
import { ClipPerformance } from "./ClipPerformance";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  const s = structuredClone(useAppStore.getState().sequencer), track = s.tracks[0];
  track.padLoopEnabled = true;
  track.padLoopPattern = { groups: [{ id: "G", sequence: [{ type: "pad", padIndex: 0 }, { type: "pad", padIndex: 0 }] }], superGroups: [{ id: "S", sequence: [{ type: "group", groupId: "G" }] }], rootSequence: [{ type: "super", superGroupId: "S" }] };
  s.clipArrangement = migrateClipArrangement(s).model!;
  useAppStore.setState({ sequencer: s });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("expands the nested boxes, opens a container, defaults to local save and preserves a cancelled draft", async () => {
  const track = useAppStore.getState().sequencer.tracks[0];
  render(<ClipPerformance language="english" renderEditor={() => null} />);
  const toggle = screen.getByRole("button", { name: `▸ ${track.name}` });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  fireEvent.keyDown(screen.getByRole("button", { name: "▤ S" }), { key: "Enter" });
  expect(screen.getByRole("region", { name: "Editing" })).toBeTruthy();
  fireEvent.click(within(screen.getByRole("region", { name: "Editing" })).getByRole("button", { name: "Rest +1" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  let dialog = screen.getByRole("dialog", { name: "Save changes" });
  expect((within(dialog).getByRole("radio", { name: "Only this occurrence" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("Unsaved draft")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  dialog = screen.getByRole("dialog");
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Save" })));
  expect(useAppStore.getState().clipEditingKey).toBeNull();
  expect(useAppStore.getState().sequencer.clipHistory?.cursor).toBe(1);
});
