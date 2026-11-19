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

function open(clip: boolean) {
  const sequencer = structuredClone(useAppStore.getState().sequencer),
    track = sequencer.tracks[0];
  const padIndex = clip ? 0 : 3;
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
