// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConfigPage } from "./ConfigPage";
import { LOCAL_BROWSER_CLOCK_LATENCY_SETTINGS as settings } from "../lib/browserClockLatencyConfig";
import { BROWSER_PLAYBACK_COPY } from "../lib/browserPlaybackCopy";
import type { GuiLanguage } from "../types";

afterEach(cleanup);

it.each(["english", "german", "french", "spanish"] as GuiLanguage[])("offers translated modes, validates timeout and preserves advanced tuning (%s)", language => {
  const apply = vi.fn();
  const copy = BROWSER_PLAYBACK_COPY[language];
  render(<ConfigPage guiLanguage={language} audioRate={48000} controlRate={1500} ksmps={32} softwareBuffer={128}
    hardwareBuffer={512} showBrowserClockLatencyConfig browserClockLatencySettings={settings}
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
