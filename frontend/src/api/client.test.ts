import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import type { PersistedAppState } from "../types";

afterEach(() => vi.unstubAllGlobals());

describe("app-state persistence responses", () => {
  it("does not parse the unused full state returned by autosave", async () => {
    const response = new Response(JSON.stringify({ state: { version: 1 } }));
    const parse = vi.spyOn(response, "json");
    const cancel = vi.spyOn(response.body!, "cancel");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await api.saveAppState({ version: 1 } as PersistedAppState);
    expect(parse).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("still parses state when loading and propagates save failures", async () => {
    const state = { state: { version: 1 }, updated_at: "2026-09-15T00:00:00Z" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(state)))
      .mockResolvedValueOnce(new Response("storage unavailable", { status: 503 })));
    expect(await api.getAppState()).toEqual(state);
    await expect(api.saveAppState({ version: 1 } as PersistedAppState)).rejects.toThrow("storage unavailable");
  });
});
