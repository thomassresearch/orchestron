// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CsdExportOptionsDialog } from "./CsdExportOptionsDialog";
import { useCsdExportOptionsDialog } from "../hooks/useCsdExportOptionsDialog";

afterEach(cleanup);

it.each(["english", "german", "french", "spanish"] as const)("opens at 1 CC and exports the selected accuracy in %s", guiLanguage => {
  const onClose = vi.fn();
  render(<CsdExportOptionsDialog showCurveAccuracy showCompanionLocation guiLanguage={guiLanguage} onClose={onClose} />);
  const slider = screen.getByRole("slider") as HTMLInputElement;
  expect(slider.value).toBe("1");
  expect(slider.min).toBe("1");
  expect(slider.max).toBe("10");
  expect(slider.step).toBe("1");
  expect(document.activeElement).toBe(slider);
  fireEvent.change(slider, { target: { value: "10" } });
  const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  fireEvent.click(checkbox);
  fireEvent.click(screen.getAllByRole("button")[1]);
  expect(onClose).toHaveBeenCalledWith({ controllerCurveTolerance: 10, samplesInSubfolder: false });
});

it("keeps keyboard focus inside the dialog and supports Escape", () => {
  const onClose = vi.fn();
  render(<CsdExportOptionsDialog showCurveAccuracy showCompanionLocation={false} guiLanguage="english" onClose={onClose} />);
  expect(screen.queryByRole("checkbox")).toBeNull();
  const slider = screen.getByRole("slider");
  const confirm = screen.getByRole("button", { name: "Export CSD" });
  fireEvent.keyDown(slider, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(confirm);
  fireEvent.keyDown(confirm, { key: "Tab" });
  expect(document.activeElement).toBe(slider);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(onClose).toHaveBeenCalledWith(null);
});

it("cancel never exports and each new export starts at the default", async () => {
  const exported = vi.fn();
  function Harness() {
    const { controls, request, close } = useCsdExportOptionsDialog();
    return <>
      <button onClick={async () => { const value = await request({ showCurveAccuracy: false, showCompanionLocation: true }); if (value !== null) exported(value); }}>Start export</button>
      {controls && <CsdExportOptionsDialog {...controls} guiLanguage="english" onClose={close} />}
    </>;
  }
  const { unmount } = render(<Harness />);
  fireEvent.click(screen.getByText("Start export"));
  expect(screen.queryByRole("slider")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByText("Cancel"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(exported).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Start export"));
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Export CSD" }));
  await waitFor(() => expect(exported).toHaveBeenCalledExactlyOnceWith({ samplesInSubfolder: true }));
  fireEvent.click(screen.getByText("Start export"));
  await act(async () => unmount());
  expect(exported).toHaveBeenCalledTimes(1);
});
