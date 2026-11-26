// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import fixture from "../../../../backend/tests/fixtures/sample_player/performance.json";
import { api } from "../../api/client";
import { createSamplePlayerPatch } from "../../lib/samplePlayer";
import { toPatchListItem } from "../../lib/patchCatalog";
import { parseSequencerConfigSnapshot } from "../../store/appStoreModel";
import { useAppStore } from "../../store/useAppStore";
import { SamplePlayerRack } from "./SamplePlayerRack";

const initial = useAppStore.getState();
const patch = toPatchListItem({ ...createSamplePlayerPatch(), id: "sample-player-test", created_at: "", updated_at: "" });
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

it("keeps Preview disabled until the previous gesture finishes stopping", async () => {
  useAppStore.setState({ activeSessionState: "running", activeSessionId: "live-sampler" });
  let finishStop!: () => void;
  const request = vi.spyOn(api, "previewSample").mockResolvedValueOnce(undefined)
    .mockImplementationOnce(() => new Promise(resolve => { finishStop = resolve; }))
    .mockResolvedValue(undefined);
  rack(true);
  fireEvent.click(screen.getByRole("button", { name: /^36 ·/ }));
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
  expect(screen.getByRole("button", { name: "Stopping…" }).hasAttribute("disabled")).toBe(true);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await act(async () => finishStop());
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
});

it("assigns M4A audio through the rack file picker", async () => {
  const { container } = rack();
  expect(screen.queryByRole("button", { name: "Duplicate instance" })).toBeNull();
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(input.accept.split(",")).toContain(".m4a");
  const [id, original] = Object.entries(useAppStore.getState().sequencerInstruments[1].sampleAssets!)[0];
  const asset = { ...original, source: { ...original.source, format: "m4a" as const,
    stored_name: `sam-${original.source.sha256}.m4a`, original_name: "recording.m4a" } };
  const upload = vi.spyOn(api, "uploadSample").mockResolvedValue({ asset_id: id, asset });
  const file = new File(["audio"], "recording.m4a", { type: "audio/mp4" });
  fireEvent.click(screen.getByRole("button", { name: "Replace file: 36" }));
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(useAppStore.getState().sampleUploads).toBe(0));
  expect(upload).toHaveBeenCalledWith(file, expect.any(AbortSignal));
  expect(useAppStore.getState().sequencerInstruments[0].sampleAssets?.[id]).toEqual(asset);
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
