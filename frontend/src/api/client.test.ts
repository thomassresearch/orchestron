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

describe("structured routing errors", () => {
  it("keeps structured diagnostics and formats a readable error instead of JSON", async () => {
    const { ApiError } = await import("./client");
    const diagnostic = { code: "feedback", severity: "error", message: "Lead → Reverb → Lead", routeIds: ["send", "return"] };
    const body = JSON.stringify({ detail: { diagnostics: ["Audio feedback loop.", diagnostic.message], audioDiagnostics: [diagnostic] } });
    const error = new ApiError(422, "Unprocessable Content", body);
    expect(error.message).toBe("API 422 Unprocessable Content: Audio feedback loop.\nLead → Reverb → Lead");
    expect(error.audioDiagnostics).toEqual([diagnostic]);
    expect(error.body).toBe(body);
    expect(new ApiError(500, "Server Error", "unavailable").message).toContain("unavailable");
    expect(new ApiError(422, "Invalid", '{"detail":[{"msg":"field required"}]}').audioDiagnostics).toEqual([]);
  });
});
