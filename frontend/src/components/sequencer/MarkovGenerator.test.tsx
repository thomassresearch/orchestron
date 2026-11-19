// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarkovGenerator } from "./MarkovGenerator";
import { PerformanceAuditionContext, type AuditionDevice } from "./PerformanceAudition";
import { ClipEditingContext } from "../clipArranger/context";
import { useAppStore } from "../../store/useAppStore";
import { migrateClipArrangement } from "../../lib/clipArranger/migration";
import { openClipEditor } from "../../store/clipActions";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(cleanup);

function open(clip: boolean, notes = false) {
  const sequencer = structuredClone(useAppStore.getState().sequencer),
    track = sequencer.tracks[0];
  const padIndex = clip ? 0 : 3;
  if (notes) {
    const cells = track.pads[padIndex].steps;
    cells[0] = { ...cells[0], note: 49 };
    cells[1] = { ...cells[1], hold: true };
    cells[2] = { ...cells[2], note: 85 };
    cells[3] = { ...cells[3], hold: true };
  }
  track.padLoopEnabled = true;
  track.padLoopPattern.rootSequence = [{ type: "pad", padIndex: 0 }];
  sequencer.clipArrangement = clip ? migrateClipArrangement(sequencer).model! : undefined;
  useAppStore.setState({ sequencer });
  if (clip) {
    const lane = sequencer.clipArrangement!.lanes[0],
      item = lane.clips[0].children[0];
    openClipEditor({ laneId: lane.id, clipId: lane.clips[0].id, path: [item.id], pass: 0 }, "local");
  }
  const audition = vi.fn<AuditionDevice>().mockResolvedValue(undefined);
  render(
    <PerformanceAuditionContext.Provider value={audition}>
      <ClipEditingContext.Provider value={clip}>
        <MarkovGenerator
          name={track.name}
          id={track.id}
          language="english"
          padIndex={padIndex}
          timing={track.timing}
          pattern={{ source: "sequencer", payload: track.pads[padIndex] }}
        />
      </ClipEditingContext.Provider>
    </PerformanceAuditionContext.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Markov Generator" }));
  return { audition, sequencer, dialog: within(screen.getByRole("dialog")), padIndex };
}

it.each([false, true])(
  "keeps generation session-only and applies the exact audition snapshot (clip=%s)",
  async (clip) => {
    const { dialog, audition, sequencer, padIndex } = open(clip);
    const originalDrafts = useAppStore.getState().clipDrafts;
    fireEvent.change(dialog.getByRole("combobox", { name: "Pitch · Phrase length" }), { target: { value: "4" } });
    fireEvent.click(dialog.getByRole("button", { name: /Play$/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Generate" }));
    // Settle the outstanding preparation before accepting the newest take.
    await vi.waitFor(() =>
      expect(dialog.getByRole("button", { name: "Use pattern" }).hasAttribute("disabled")).toBe(false),
    );
    expect(audition).toHaveBeenCalledTimes(2);
    const pending = useAppStore.getState(),
      heard = clip ? pending.clipAuditionDraft!.definition : pending.padAudition!.pattern;
    if (!("payload" in heard)) throw Error();
    expect(pending.sequencer).toBe(sequencer);
    expect(pending.clipDrafts).toBe(originalDrafts);
    fireEvent.click(dialog.getByRole("button", { name: "Use pattern" }));
    const state = useAppStore.getState();
    const accepted = clip
      ? state.clipDrafts[state.clipEditingKey!].definition
      : { payload: state.sequencer.tracks[0].pads[padIndex] };
    if (!("payload" in accepted)) throw Error();
    expect(accepted.payload).toEqual(heard.payload);
    expect(state.sequencer.tracks[0].pads[0]).toEqual(sequencer.tracks[0].pads[0]);
    expect(state.sequencer.clipArrangement).toBe(sequencer.clipArrangement);
    expect(state.clipAuditionDraft).toBeNull();
    expect(state.padAudition).toBeNull();
    expect(audition.mock.lastCall?.[1]).toMatchObject({ action: "workspace_end" });
  },
);
it("keeps a percentage edit reversible and dismisses without changing the draft", () => {
  const { dialog, sequencer, audition } = open(false);
  const edge = dialog.getAllByRole("button", { name: /Start → / })[0],
    label = edge.getAttribute("aria-label");
  fireEvent.click(edge);
  fireEvent.change(dialog.getByRole("spinbutton"), { target: { value: "80" } });
  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(edge.getAttribute("aria-label")).toBe(label);
  fireEvent.click(dialog.getByRole("button", { name: "Generate" }));
  fireEvent.click(dialog.getByRole("button", { name: "Close" }));
  expect(useAppStore.getState().sequencer).toBe(sequencer);
  expect(audition).not.toHaveBeenCalled();
});

it("offers the two independent filters only on a non-empty pattern and cannot use an incompatible preview", async () => {
  let view = open(false);
  expect(view.dialog.queryByRole("checkbox", { name: "Keep pitches" })).toBeNull();
  cleanup();
  view = open(false, true);
  const { dialog, padIndex } = view;
  const pitches = dialog.getByRole("checkbox", { name: "Keep pitches" });
  const durations = dialog.getByRole("checkbox", { name: "Keep durations" });
  const states = (title: string) =>
    [...(dialog.getByRole("combobox", { name: title + " · From" }) as HTMLSelectElement).options].map(
      (o) => o.text,
    );
  const fullPitches = states("Pitch"),
    fullDurations = states("Duration");
  fireEvent.click(pitches);
  expect(states("Pitch")).toHaveLength(4);
  expect(states("Duration")).toEqual(fullDurations);
  fireEvent.click(durations);
  expect(states("Duration")).toEqual(["Start", "2"]);
  fireEvent.change(dialog.getByRole("combobox", { name: "Duration · Phrase length" }), { target: { value: "1" } });
  expect(dialog.getByRole("button", { name: "Use pattern" }).hasAttribute("disabled")).toBe(false);
  // Switching back to the unrestricted graph and then tightening it again must
  // never offer the unrestricted take under an unsatisfiable duration filter.
  fireEvent.click(durations);
  fireEvent.click(durations);
  expect(dialog.getByRole("button", { name: "Use pattern" }).hasAttribute("disabled")).toBe(true);
  fireEvent.change(dialog.getByRole("combobox", { name: "Duration · Phrase length" }), {
    target: { value: "16" },
  });
  fireEvent.click(pitches);
  expect(states("Pitch")).toEqual(fullPitches);
  expect(states("Duration")).toEqual(["Start", "2"]);
  fireEvent.click(pitches);
  fireEvent.click(dialog.getByRole("button", { name: "Generate" }));
  fireEvent.click(dialog.getByRole("button", { name: "Use pattern" }));
  const cells = useAppStore.getState().sequencer.tracks[0].pads[padIndex].steps.slice(0, 16);
  cells.forEach((cell, i) => {
    if (cell.note === null) return;
    expect([49, 85]).toContain(cell.note);
    expect(cells[i + 1].hold).toBe(true);
  });
});

it("opens a focused slider on its edge and returns focus when the edit ends", () => {
  const { dialog } = open(false);
  const edge = dialog.getByRole("button", { name: /^Start → C4 ·/ });
  fireEvent.keyDown(edge, { key: "Enter" });
  const popup = dialog.getByRole("dialog", { name: "Start → C4" });
  expect(popup.id).toBe(edge.getAttribute("aria-controls"));
  const slider = within(popup).getByRole("slider");
  expect(document.activeElement).toBe(slider);
  fireEvent.change(slider, { target: { value: "42" } });
  fireEvent.click(within(popup).getByRole("button", { name: "Apply" }));
  expect(edge.getAttribute("aria-label")).toMatch(/42%$/);
  expect(document.activeElement).toBe(edge);
  fireEvent.click(edge);
  fireEvent.change(dialog.getByRole("spinbutton"), { target: { value: "10" } });
  fireEvent.keyDown(dialog.getByRole("spinbutton"), { key: "Escape" });
  expect(dialog.queryByRole("slider")).toBeNull();
  expect(document.activeElement).toBe(edge);
  expect(edge.getAttribute("aria-label")).toMatch(/42%$/);
  fireEvent.click(edge);
  fireEvent.pointerDown(dialog.getByRole("button", { name: "Generate" }));
  expect(dialog.queryByRole("slider")).toBeNull();
});
