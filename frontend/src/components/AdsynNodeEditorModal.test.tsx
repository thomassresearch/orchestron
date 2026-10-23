// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { SfloadNodeEditorModal, adsynEditorCopy } from "./SfloadNodeEditorModal";
import { defaultSfloadNodeConfig } from "../lib/sfloadNodeConfig";

vi.mock("../api/client", () => ({ api: { uploadGenAudioAsset: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("adsyn analysis upload", () => {
  it.each(["english", "german", "french", "spanish"] as const)("localizes file configuration in %s", guiLanguage => {
    render(<SfloadNodeEditorModal opcode="adsyn" nodeId="tone" guiLanguage={guiLanguage} initialConfig={defaultSfloadNodeConfig()} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(adsynEditorCopy(guiLanguage).title)).toBeTruthy();
    expect(screen.getByText(adsynEditorCopy(guiLanguage).note)).toBeTruthy();
  });
  it("uploads, saves and clears an analysis asset", async () => {
    const asset = { asset_id: "one", original_name: "tone.het", stored_name: "one.het", content_type: "application/octet-stream", size_bytes: 520 };
    vi.mocked(api.uploadGenAudioAsset).mockResolvedValue(asset);
    const onSave = vi.fn();
    const { container } = render(<SfloadNodeEditorModal opcode="adsyn" nodeId="tone" guiLanguage="english" initialConfig={defaultSfloadNodeConfig()} onSave={onSave} onClose={vi.fn()} />);
    const file = new File(["analysis"], "tone.het");
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("Uploaded asset: tone.het")).toBeTruthy());
    expect(api.uploadGenAudioAsset).toHaveBeenCalledWith(file);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith({ sampleAsset: asset, samplePath: "" });
    fireEvent.click(screen.getByRole("button", { name: "Clear Asset" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith({ sampleAsset: null, samplePath: "" });
  });
});
