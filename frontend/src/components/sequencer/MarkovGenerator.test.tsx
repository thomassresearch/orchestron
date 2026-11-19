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

function open(clip: boolean, notes: [number, number][] = []) {
  const sequencer = structuredClone(useAppStore.getState().sequencer),
    track = sequencer.tracks[0];
  const padIndex = clip ? 0 : 3;
  const cells = track.pads[padIndex].steps;
  let start = 0;
  for (const [note, length] of notes) {
    cells[start] = { ...cells[start], note };
    for (let i = 1; i < length; i++) cells[start + i] = { ...cells[start + i], hold: true };
    start += length;
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
  const generator = (pad = track.pads[padIndex]) => (
    <PerformanceAuditionContext.Provider value={audition}>
      <ClipEditingContext.Provider value={clip}>
        <MarkovGenerator
          name={track.name}
          id={track.id}
          language="english"
          padIndex={padIndex}
          timing={track.timing}
          pattern={{ source: "sequencer", payload: pad }}
        />
      </ClipEditingContext.Provider>
    </PerformanceAuditionContext.Provider>
  );
  const view = render(generator());
  fireEvent.click(screen.getByRole("button", { name: "Markov Generator" }));
  return {
    audition,
    sequencer,
    dialog: within(screen.getByRole("dialog")),
    padIndex,
    changePad: (pad: (typeof track.pads)[number]) => view.rerender(generator(pad)),
  };
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
  view = open(
    false,
    Array.from({ length: 8 }, (_, i) => [i % 2 ? 85 : 49, 2]),
  );
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

it("seeds each enabled graph independently and keeps edge edits until that switch is enabled again", () => {
  const { dialog } = open(false, [
    [60, 2],
    [62, 4],
    [60, 2],
    [62, 4],
    [60, 2],
    [64, 2],
  ]);
  const pitch = dialog.getByRole("checkbox", { name: "Keep pitches" });
  const rhythm = dialog.getByRole("checkbox", { name: "Keep durations" });
  const from = (graph: string, state: string) => {
    const select = dialog.getByRole("combobox", { name: graph + " · From" }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: [...select.options].find((o) => o.text === state)!.value } });
  };
  const edge = (name: string) => dialog.getByRole("button", { name });
  const edit = (name: string, value: string) => {
    fireEvent.click(edge(name));
    const slider = dialog.getByRole("slider") as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    fireEvent.change(slider, { target: { value } });
    fireEvent.click(edge("Apply"));
  };
  fireEvent.click(pitch);
  expect(edge("Start → C4 · 100%")).toBeTruthy();
  from("Pitch", "C4");
  edit("C4 → D4 · 66.7%", "80");
  fireEvent.click(rhythm);
  expect(edge("C4 → D4 · 80%")).toBeTruthy();
  from("Duration", "2");
  expect(edge("2 → 4 · 50%")).toBeTruthy();
  from("Duration", "4");
  edit("4 → 2 · 100%", "70");
  fireEvent.click(edge("Generate"));
  expect(edge("4 → 2 · 70%")).toBeTruthy();
  fireEvent.click(pitch);
  fireEvent.click(pitch);
  from("Pitch", "C4");
  expect(edge("C4 → D4 · 66.7%")).toBeTruthy();
  expect(edge("4 → 2 · 70%")).toBeTruthy();
  fireEvent.click(rhythm);
  fireEvent.click(rhythm);
  from("Duration", "4");
  expect(edge("4 → 2 · 100%")).toBeTruthy();
  edit("4 → 4 · 0%", "25");
  expect(edge("4 → 2 · 75%")).toBeTruthy();
});

it("retains an edited graph on reopen and relearns when the source changes with identical labels", () => {
  const { dialog, changePad, sequencer, padIndex } = open(false, [
    [60, 4],
    [62, 4],
    [60, 4],
    [64, 4],
  ]);
  fireEvent.click(dialog.getByRole("checkbox", { name: "Keep pitches" }));
  fireEvent.click(dialog.getByRole("button", { name: "Start → C4 · 100%" }));
  fireEvent.change(dialog.getByRole("slider"), { target: { value: "85" } });
  fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
  const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
  click("Close");
  click("Markov Generator");
  expect(screen.getByRole("button", { name: "Start → C4 · 85%" })).toBeTruthy();
  click("Close");
  const pad = structuredClone(sequencer.tracks[0].pads[padIndex]);
  [pad.steps[0], pad.steps[4]] = [pad.steps[4], pad.steps[0]];
  changePad(pad);
  click("Markov Generator");
  expect(screen.getByRole("button", { name: "Start → D4 · 100%" })).toBeTruthy();
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

it("keeps the native range drag active when the browser focuses the outer dialog on pointer-down", () => {
  const { dialog } = open(false);
  const outer = screen.getByRole("dialog", { name: "Markov Generator" });
  outer.tabIndex = -1;
  const edge = dialog.getByRole("button", { name: /^Start → C4 ·/ });
  fireEvent.click(edge);
  const slider = dialog.getByRole("slider");
  fireEvent.pointerDown(slider);
  outer.focus(); // WebKit's native default action when pressing the range thumb.
  expect(document.activeElement).toBe(slider);
  fireEvent.input(slider, { target: { value: "35" } });
  fireEvent.input(slider, { target: { value: "72" } });
  fireEvent.pointerUp(slider);
  expect(dialog.getByRole("slider")).toBe(slider);
  fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
  expect(edge.getAttribute("aria-label")).toMatch(/72%$/);
  fireEvent.click(edge);
  const reopened = dialog.getByRole("slider");
  fireEvent.pointerDown(reopened);
  fireEvent.pointerCancel(reopened);
  fireEvent.focusIn(outer);
  expect(dialog.queryByRole("slider")).toBeNull();
});
