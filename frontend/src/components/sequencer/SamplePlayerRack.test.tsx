// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import fixture from "../../../../backend/tests/fixtures/sample_player/performance.json";
import { api } from "../../api/client";
import { audioTemplate } from "../../lib/audioTemplates";
import { toPatchListItem } from "../../lib/patchCatalog";
import { parseSequencerConfigSnapshot } from "../../store/appStoreModel";
import { useAppStore } from "../../store/useAppStore";
import { SamplePlayerRack } from "./SamplePlayerRack";

const initial = useAppStore.getState();
const patch = toPatchListItem({ ...audioTemplate("samplePlayer"), id: "sample-player-test" });
const fixtureBindings = () => parseSequencerConfigSnapshot(fixture, [patch], null).instruments;

function rack(running = false) {
  const node = render(<SamplePlayerRack binding={useAppStore.getState().sequencerInstruments[0]} label="Patch 1 · Channel 1"
    language="english" capable running={running} />);
  fireEvent.click(screen.getByRole("button", { name: "Samples · 2" }));
  return node;
}

beforeEach(() => {
  useAppStore.setState({ patches: [patch], sequencerInstruments: fixtureBindings(), activeSessionState: "idle", sampleUploads: 0 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAppStore.setState(initial, true);
});

it("rejects an occupied note and retains every assignment on a failed file replacement", async () => {
  const before = structuredClone(useAppStore.getState().sequencerInstruments);
  const upload = vi.spyOn(api, "uploadSample").mockRejectedValue(new Error("Could not read WAV"));
  const { container } = rack();
  const note = screen.getByRole("spinbutton", { name: "MIDI note 127" });
  fireEvent.change(note, { target: { value: "36" } });
  fireEvent.blur(note);
  expect(screen.getByRole("alert").textContent).toContain("already has a sample");
  expect((note as HTMLInputElement).value).toBe("127");
  fireEvent.click(screen.getByRole("button", { name: "Replace file: 36" }));
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["bad"], "bad.wav")] } });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not read WAV"));
  expect(upload).toHaveBeenCalledOnce();
  expect(useAppStore.getState().sequencerInstruments).toEqual(before);
});

it("locks edits while the engine is running and rejects an upload from an old workspace", async () => {
  const { container, rerender } = rack();
  let finish!: (value: Awaited<ReturnType<typeof api.uploadSample>>) => void;
  const upload = vi.spyOn(api, "uploadSample").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const before = useAppStore.getState();
  fireEvent.click(screen.getByRole("button", { name: "Replace file: 36" }));
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["test"], "sample.wav")] } });
  expect(useAppStore.getState().sampleUploads).toBe(1);
  await useAppStore.getState().startSession();
  expect(useAppStore.getState().error).toContain("Wait for the sample upload");
  act(() => useAppStore.setState({ performanceWorkspaceGeneration: before.performanceWorkspaceGeneration + 1, activeSessionState: "running" }));
  rerender(<SamplePlayerRack binding={before.sequencerInstruments[0]} label="Patch 1 · Channel 1" capable running language="english" />);
  expect((screen.getByRole("button", { name: "Assign file" }) as HTMLButtonElement).disabled).toBe(true);
  const [id, asset] = Object.entries(before.sequencerInstruments[1].sampleAssets!)[0];
  await act(async () => { finish({ asset_id: id, asset }); });
  expect(upload.mock.calls[0][1].aborted).toBe(true);
  expect(useAppStore.getState().sampleUploads).toBe(0);
  expect(useAppStore.getState().sequencerInstruments).toBe(before.sequencerInstruments);
});
