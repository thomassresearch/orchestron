// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../store/useAppStore";
import { useMidiControllerRouting } from "./useMidiControllerRouting";

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));
afterEach(cleanup);
const errors = { failedToSendMidiControllerValue: "Send failed", failedToInitializeMidiControllers: "Init failed" };

it("routes initialization, channel changes, CC changes, and knob changes to each lane's current selection", async () => {
  const store = useAppStore.getState();
  const id = store.sequencer.midiControllers[0].id;
  store.setMidiControllerTargetChannels(id, [1, 16]);
  store.setMidiControllerNumber(id, 74);
  store.setMidiControllerValue(id, 30);
  store.setMidiControllerEnabled(id, true);
  const send = vi.fn().mockResolvedValue(undefined);
  const { result, rerender } = renderHook(({ state }) => useMidiControllerRouting({
    activeSessionId: "session", activeSessionState: state, sendDirectMidiEvent: send, setSequencerError: vi.fn(), errors
  }), { initialProps: { state: "running" } });
  const messages = () => send.mock.calls.map(([event]) => event);
  expect(messages()).toEqual([1, 16].map(channel => ({ type: "control_change", channel, controller: 74, value: 30 })));
  send.mockClear();
  act(() => result.current.onMidiControllerTargetChannelsChange(id, [2, 16]));
  expect(messages()).toEqual([2, 16].map(channel => ({ type: "control_change", channel, controller: 74, value: 30 })));
  send.mockClear();
  act(() => result.current.onMidiControllerNumberChange(id, 71));
  expect(messages().map(message => [message.channel, message.controller])).toEqual([[2, 71], [16, 71]]);
  send.mockClear();
  act(() => result.current.onMidiControllerValueChange(id, 91));
  expect(messages()).toEqual([2, 16].map(channel => ({ type: "control_change", channel, controller: 71, value: 91 })));
  send.mockClear();
  act(() => result.current.onMidiControllerEnabledChange(id, false));
  act(() => result.current.onMidiControllerTargetChannelsChange(id, [1]));
  act(() => result.current.onMidiControllerValueChange(id, 12));
  expect(send).not.toHaveBeenCalled();
  act(() => result.current.onMidiControllerEnabledChange(id, true));
  expect(messages()).toEqual([{ type: "control_change", channel: 1, controller: 71, value: 12 }]);
  send.mockClear();
  act(() => result.current.onMidiControllerTargetChannelsChange(id, []));
  expect(send).not.toHaveBeenCalled();
  expect(useAppStore.getState().sequencer.midiControllers[0].targetChannels).toEqual([1]);
  rerender({ state: "stopped" });
  act(() => result.current.onMidiControllerValueChange(id, 63));
  expect(send).not.toHaveBeenCalled();
  rerender({ state: "running" });
  expect(messages()).toEqual([{ type: "control_change", channel: 1, controller: 71, value: 63 }]);
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
});

it("defaults to all 16 channels and reports sending failures", async () => {
  const id = useAppStore.getState().sequencer.midiControllers[0].id;
  const send = vi.fn().mockRejectedValue(new Error("Offline"));
  const setError = vi.fn();
  const { result } = renderHook(() => useMidiControllerRouting({ activeSessionId: "session", activeSessionState: "running",
    sendDirectMidiEvent: send, setSequencerError: setError, errors }));
  act(() => result.current.onMidiControllerEnabledChange(id, true));
  expect(send.mock.calls.map(([event]) => event.channel)).toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
  await waitFor(() => expect(setError).toHaveBeenCalledWith("Offline"));
});
