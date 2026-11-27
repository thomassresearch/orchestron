// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Dx7VoiceEditor } from "./Dx7VoiceEditor";
import { dx7Algorithms, dx7Offset, dx7Voice, encodeDx7 } from "../lib/dx7";
import { dx7Copy } from "../lib/dx7Copy";
import { fm6Copy } from "../lib/fm6Copy";
import bank from "../../../backend/app/data/dx7-presets.json";

afterEach(cleanup);
const base = { id: "dx", position: { x: 0, y: 0 }, opcode: "fm_dx7", params: {} };

it.each(["english", "german", "french", "spanish"] as const)("edits a selected DX7 operator and restores an implicit opening voice in %s", language => {
  const copy = dx7Copy(language), fm = fm6Copy(language), change = vi.fn(), close = vi.fn();
  render(<Dx7VoiceEditor language={language} node={base} onChange={change} onClose={close} />);
  const op = screen.getByRole("button", { name: `${fm.operator} 2 ${fm.carrier}` });
  fireEvent.keyDown(op, { key: "Enter" });
  const inspector = within(screen.getByRole("region", { name: `${fm.operator} 2` }));
  const plot = within(op).getByRole("img").querySelector("polyline")!;
  const before = plot.getAttribute("points");
  fireEvent.change(inspector.getByRole("slider", { name: `${copy.rate} 4` }), { target: { value: "12" } });
  expect(plot.getAttribute("points")).not.toBe(before);
  fireEvent.change(inspector.getByRole("slider", { name: `${copy.levelEG} 4` }), { target: { value: "35" } });
  const current = dx7Voice({ voice: change.mock.lastCall![0] });
  expect(current[dx7Offset(2) + 3]).toBe(12);
  expect(current[dx7Offset(2) + 7]).toBe(35);
  expect(current.slice(0, 21)).toEqual(dx7Voice({}).slice(0, 21));
  fireEvent.change(screen.getByRole("combobox", { name: fm.algorithm }), { target: { value: "3" } });
  expect(screen.getByRole("button", { name: `${fm.operator} 2 ${fm.modulator}` })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: fm.cancel }));
  expect(change.mock.lastCall).toEqual([undefined, undefined]); expect(close).toHaveBeenCalledOnce();
});

it("keeps Custom while browsing, reopens an applied preset and rolls back edits to both slots", () => {
  const custom = dx7Voice({});
  custom[134] = 19;
  const original = encodeDx7(custom);
  const fm = fm6Copy("english"), change = vi.fn(), close = vi.fn();
  const mount = (voice: string, saved?: string) => render(<Dx7VoiceEditor language="english" onChange={change} onClose={close}
    node={{ ...base, params: saved ? { voice, custom_voice: saved } : { voice } }} />);
  const selector = () => screen.getByRole("combobox", { name: fm.preset }) as HTMLSelectElement;
  const choose = (id: number) => fireEvent.change(selector(), { target: { value: String(id) } });
  const first = bank.presets[0], last = bank.presets[31];
  const view = mount(original);
  expect(selector().options).toHaveLength(33);
  choose(first.id);
  expect(change.mock.lastCall).toEqual([first.voice, original]);
  choose(last.id);
  expect(change.mock.lastCall).toEqual([last.voice, original]);
  choose(0);
  expect(change.mock.lastCall).toEqual([original, undefined]);
  choose(last.id);
  fireEvent.click(screen.getByRole("button", { name: fm.apply }));
  const [voice, saved] = change.mock.lastCall!;
  view.unmount();
  mount(voice, saved);
  expect(selector().value).toBe(String(last.id));
  choose(first.id);
  fireEvent.change(screen.getByRole("textbox", { name: "Voice name" }), { target: { value: "My bass" } });
  expect(selector().value).toBe("0");
  const edited = change.mock.lastCall![0];
  choose(first.id);
  expect(change.mock.lastCall).toEqual([first.voice, edited]);
  choose(0);
  expect(change.mock.lastCall).toEqual([edited, undefined]);
  fireEvent.click(screen.getByRole("button", { name: fm.cancel }));
  expect(change.mock.lastCall).toEqual([last.voice, original]);
});

it("retains imported bytes, supports spaces in a voice name and applies the draft", () => {
  const bytes = dx7Voice({}); bytes[19] = 127; bytes[144] = 36;
  const change = vi.fn(), close = vi.fn();
  render(<Dx7VoiceEditor language="english" node={{ ...base, params: { voice: encodeDx7(bytes) } }} onClose={close} onChange={change} />);
  const name = screen.getByRole("textbox", { name: "Voice name" });
  for (const text of ["My", "My ", "My Voice"]) fireEvent.change(name, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: fm6Copy("english").apply }));
  const newVoice = dx7Voice({ voice: change.mock.lastCall![0] });
  expect(newVoice.slice(0,145)).toEqual(bytes.slice(0,145));
  expect(String.fromCharCode(...newVoice.slice(145))).toBe("My Voice  ");
  expect(close).toHaveBeenCalledOnce();
});

it("places every modulator upstream with distinct positions in all 32 diagrams", () => {
  for (const route of dx7Algorithms) {
    expect(new Set(route.positions.map(p => p.join(","))).size).toBe(6);
    for (const [from, to] of route.edges) expect(route.positions[from-1][1]).toBeLessThan(route.positions[to-1][1]);
  }
});
