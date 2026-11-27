// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { Dx7VoiceImport } from "./Dx7VoiceImport";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("keeps a bank selection in the dialog until Use voice and clears it after an invalid upload", async () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const decode = vi.spyOn(api, "dx7Voices").mockResolvedValue([
    { name: "Tine Keys", algorithm: 5, voice: "tine" }, { name: "Iron Bell", algorithm: 3, voice: "metal" }
  ]);
  const editor = () => render(<Dx7VoiceImport language="english" onClose={onClose} onSelect={onSelect}
    node={{ id: "dx", opcode: "fm_dx7", position: { x: 0, y: 0 }, params: {} }} />);
  const file = new File([new Uint8Array(4104)], "bank.syx");
  const choose = (selected: File) => fireEvent.change(screen.getByLabelText("Choose SysEx file"), { target: { files: [selected] } });

  editor();
  choose(file);
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
  cleanup();

  editor();
  choose(file);
  await screen.findByRole("combobox");
  choose(new File(["invalid"], "bad.syx"));
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByRole("button", { name: "Use voice" }).hasAttribute("disabled")).toBe(true);
  expect(decode).toHaveBeenCalledTimes(2);
  choose(file);
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Use voice" }));
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith("metal"));
});
