import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand";
import { api } from "../api/client";
import { createMixerActions } from "./appStoreMixer";
import { useAppStore } from "./useAppStore";
import type { AppStore } from "./appStoreTypes";
import { emptyAudioGraph, emptyMixer } from "../lib/audioRouting";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("mixer control batching", () => {
  it("coalesces drag targets, immediately flushes the final target and preserves local state on errors", async () => {
    vi.useFakeTimers();
    const graph = emptyAudioGraph();
    const store = createStore<AppStore>(() => ({...useAppStore.getInitialState(), audioGraph:graph,mixer:emptyMixer(),patches:[],activeSessionId:"mix-session",activeSessionState:"running",activeSessionAudioSignature:JSON.stringify({graph,patches:[]})}));
    const actions = createMixerActions(store.setState,store.getState);
    vi.spyOn(api,"getMixer").mockResolvedValue({mixer:emptyMixer(),revision:3});
    const update = vi.spyOn(api,"updateMixer").mockImplementation(async (_id,mixer,revision) => ({mixer,revision:(revision ?? 0)+1}));
    for (let i=0;i<100;i++) actions.setMixerStrip("one",{gainDb:-i/10});
    expect(update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(34);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1].strips.one.gainDb).toBe(-9.9);
    actions.setMixerStrip("one",{gainDb:-6});
    await actions.flushMixer();
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][2]).toBe(4);
    update.mockRejectedValueOnce(new Error("stale revision"));
    actions.setMixerStrip("one",{gainDb:null});
    await expect(actions.flushMixer()).rejects.toThrow("stale revision");
    expect(store.getState().mixer.strips.one.gainDb).toBeNull();
    expect(store.getState().mixerSyncError).toBe("stale revision");
    await actions.flushMixer();
    expect(api.getMixer).toHaveBeenCalledTimes(2);
  });
  it("keeps topology edits local until a new session is built", async () => {
    const store = createStore<AppStore>(() => ({...useAppStore.getInitialState(),activeSessionId:"old",activeSessionAudioSignature:"old-graph",activeSessionState:"compiled"}));
    const actions = createMixerActions(store.setState,store.getState);
    const update = vi.spyOn(api,"updateMixer");
    actions.setMixerSend(["new-route"],{gainDb:-6});
    await actions.flushMixer();
    expect(update).not.toHaveBeenCalled();
    expect(store.getState().mixer.sends["new-route"].gainDb).toBe(-6);
  });
  it("does not burst queued drag updates when an acknowledgment arrives", async () => {
    vi.useFakeTimers();
    const graph = emptyAudioGraph();
    const store = createStore<AppStore>(() => ({...useAppStore.getInitialState(),audioGraph:graph,mixer:emptyMixer(),patches:[],activeSessionId:"slow-session",activeSessionAudioSignature:JSON.stringify({graph,patches:[]})}));
    const actions = createMixerActions(store.setState,store.getState);
    vi.spyOn(api,"getMixer").mockResolvedValue({mixer:emptyMixer(),revision:0});
    let acknowledge!: () => void;
    const firstAck = new Promise<void>((resolve) => { acknowledge = resolve; });
    const update = vi.spyOn(api,"updateMixer").mockImplementation(async (_id,mixer,revision) => {
      await firstAck;
      return {mixer,revision:(revision ?? 0)+1};
    });
    actions.setMixerStrip("one",{gainDb:-1});
    await vi.advanceTimersByTimeAsync(34);
    expect(update).toHaveBeenCalledTimes(1);
    actions.setMixerStrip("one",{gainDb:-2});
    await vi.advanceTimersByTimeAsync(5);
    acknowledge();
    await vi.advanceTimersByTimeAsync(28);
    expect(update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][1].strips.one.gainDb).toBe(-2);
  });
});
