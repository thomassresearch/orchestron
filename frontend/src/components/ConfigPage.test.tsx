// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConfigPage } from "./ConfigPage";
import { LOCAL_BROWSER_CLOCK_LATENCY_SETTINGS as settings } from "../lib/browserClockLatencyConfig";
import { BROWSER_PLAYBACK_COPY } from "../lib/browserPlaybackCopy";
import { PARALLEL_PLAYBACK_COPY } from "../lib/parallelPlaybackCopy";
import type { GuiLanguage } from "../types";

afterEach(cleanup);

it.each(["english", "german", "french", "spanish"] as GuiLanguage[])("offers translated modes, validates timeout and preserves advanced tuning (%s)", language => {
  const apply = vi.fn();
  const copy = BROWSER_PLAYBACK_COPY[language];
  render(<ConfigPage guiLanguage={language} audioRate={48000} controlRate={1500} ksmps={32} softwareBuffer={128}
    hardwareBuffer={512} showBrowserClockLatencyConfig browserClockLatencySettings={settings}
    parallelRenderBatchFrames={256} parallelSettingsLocked={false} onApplyParallelRenderBatchFrames={vi.fn()}
    onApplyEngineConfig={vi.fn()} onApplyBrowserClockLatencySettings={apply} />);
  const mode = screen.getByRole("combobox", { name: copy.mode }) as HTMLSelectElement;
  expect(mode.value).toBe("auto");
  const timeout = screen.getByRole("spinbutton", { name: copy.timeout });
  expect((timeout as HTMLInputElement).value).toBe("10");
  const buttons = screen.getAllByRole("button");
  const applyButton = buttons[buttons.length - 1] as HTMLButtonElement;
  fireEvent.change(timeout, { target: { value: "0" } });
  expect(applyButton.disabled).toBe(true);
  fireEvent.change(timeout, { target: { value: "301" } });
  expect(applyButton.disabled).toBe(true);
  fireEvent.change(timeout, { target: { value: "25" } });
  fireEvent.change(mode, { target: { value: "listening" } });
  fireEvent.click(applyButton);
  expect(apply).toHaveBeenCalledWith({ ...settings, playbackMode: "listening", inactivityTimeoutSeconds: 25 });
  expect(screen.getByText(copy.buffers)).toBeTruthy();
});

it.each(["english", "german", "french", "spanish"] as GuiLanguage[])("validates and applies parallel batch sizes while stopped (%s)", language => {
  const apply = vi.fn();
  const copy = PARALLEL_PLAYBACK_COPY[language];
  const props = { guiLanguage: language, audioRate: 48000, controlRate: 1500, ksmps: 32,
    softwareBuffer: 128, hardwareBuffer: 512, showBrowserClockLatencyConfig: true,
    browserClockLatencySettings: settings, parallelRenderBatchFrames: 256, parallelSettingsLocked: false,
    onApplyParallelRenderBatchFrames: apply, onApplyEngineConfig: vi.fn(), onApplyBrowserClockLatencySettings: vi.fn() };
  const { rerender } = render(<ConfigPage {...props} />);
  const input = screen.getByRole("spinbutton", { name: copy.frames }) as HTMLInputElement;
  const button = screen.getByRole("button", { name: copy.apply }) as HTMLButtonElement;
  expect(input.value).toBe("256");
  for (const value of ["", "31", "1025", "128.5"]) {
    fireEvent.change(input, { target: { value } });
    expect(button.disabled).toBe(true);
    expect(screen.getByRole("alert")).toBeTruthy();
  }
  for (const value of [32, 128, 255, 1024]) {
    fireEvent.change(input, { target: { value: String(value) } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(apply).toHaveBeenLastCalledWith(value);
  }
  rerender(<ConfigPage {...props} parallelRenderBatchFrames={1024} parallelSettingsLocked />);
  expect(input.value).toBe("1024");
  expect(input.disabled).toBe(true);
  expect(button.disabled).toBe(true);
  expect(screen.getByText(copy.locked)).toBeTruthy();
});
