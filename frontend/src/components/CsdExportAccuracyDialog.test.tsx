// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CsdExportAccuracyDialog } from "./CsdExportAccuracyDialog";
import { useCsdExportAccuracyDialog } from "../hooks/useCsdExportAccuracyDialog";

afterEach(cleanup);

it.each(["english", "german", "french", "spanish"] as const)("opens at 1 CC and exports the selected accuracy in %s", guiLanguage => {
  const onClose = vi.fn();
  render(<CsdExportAccuracyDialog guiLanguage={guiLanguage} onClose={onClose} />);
  const slider = screen.getByRole("slider") as HTMLInputElement;
  expect(slider.value).toBe("1");
  expect(slider.min).toBe("1");
  expect(slider.max).toBe("10");
  expect(slider.step).toBe("1");
  expect(document.activeElement).toBe(slider);
  fireEvent.change(slider, { target: { value: "10" } });
  fireEvent.click(screen.getAllByRole("button")[1]);
  expect(onClose).toHaveBeenCalledWith(10);
});

it("keeps keyboard focus inside the dialog and supports Escape", () => {
  const onClose = vi.fn();
  render(<CsdExportAccuracyDialog guiLanguage="english" onClose={onClose} />);
  const slider = screen.getByRole("slider");
  const confirm = screen.getByRole("button", { name: "Export CSD" });
  fireEvent.keyDown(slider, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(confirm);
  fireEvent.keyDown(confirm, { key: "Tab" });
  expect(document.activeElement).toBe(slider);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledWith(null);
});

it("cancel never exports and each new export starts at the default", async () => {
  const exported = vi.fn();
  function Harness() {
    const { open, request, close } = useCsdExportAccuracyDialog();
    return <>
      <button onClick={async () => { const value = await request(); if (value !== null) exported(value); }}>Start export</button>
      {open && <CsdExportAccuracyDialog guiLanguage="english" onClose={close} />}
    </>;
  }
  const { unmount } = render(<Harness />);
  fireEvent.click(screen.getByText("Start export"));
  fireEvent.change(screen.getByRole("slider"), { target: { value: "8" } });
  fireEvent.click(screen.getByText("Cancel"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(exported).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Start export"));
  expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("1");
  fireEvent.change(screen.getByRole("slider"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Export CSD" }));
  await waitFor(() => expect(exported).toHaveBeenCalledExactlyOnceWith(5));
  fireEvent.click(screen.getByText("Start export"));
  await act(async () => unmount());
  expect(exported).toHaveBeenCalledTimes(1);
});
