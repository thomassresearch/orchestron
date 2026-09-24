// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useState } from "react";
import { SequencerTimingControls, BeatGroupHeaders } from "./SequencerTimingControls";
import { PerformanceEditorProvider } from "./PerformanceEditorState";
import { DEFAULT_SEQUENCER_TIMING_CONFIG as base } from "../../lib/sequencer";
import type { ControllerSequencerPadLengthBeats, GuiLanguage, SequencerTimingConfig } from "../../types";
afterEach(cleanup);
function Editor({ language = "english", controller = false }: { language?: GuiLanguage; controller?: boolean }) {
  const [timing, setTiming] = useState<SequencerTimingConfig>(base);
  const [length, setLength] = useState<ControllerSequencerPadLengthBeats>(4);
  const update = (value: Partial<SequencerTimingConfig>) => setTiming(t => ({...t,...value}));
  return <PerformanceEditorProvider><SequencerTimingControls id="test" language={language} timing={timing} lengthBeats={length} pads={[{lengthBeats:length}, {lengthBeats:controller ? 32 : 4}]} controller={controller}
    onMeterNumerator={n=>update({meterNumerator:n as 4})} onMeterDenominator={n=>update({meterDenominator:n as 4})}
    onSubdivision={n=>update({stepsPerBeat:n as 4})} onLength={n=>setLength(n as 4)} onSpeed={(n,d)=>update({beatRateNumerator:n as 1,beatRateDenominator:d as 1})}/>
    <div style={{display:"grid",gridTemplateColumns:`repeat(${length * timing.stepsPerBeat}, 1fr)`}}><BeatGroupHeaders timing={timing} stepCount={length * timing.stepsPerBeat} language={language}/></div>
    </PerformanceEditorProvider>;
}
it("selects twelve triplet steps in four beat groups and retains pattern length on meter changes", () => {
  const view = render(<Editor/>);
  const subdivision = screen.getByLabelText("Subdivision");
  fireEvent.change(subdivision, {target:{value:"3"}});
  expect(screen.getByText(/12 steps · 3 per beat/)).toBeTruthy();
  expect(view.container.querySelectorAll('[data-beat-group]')).toHaveLength(4);
  expect((screen.getByLabelText("Pattern length") as HTMLSelectElement).value).toBe("4");
  fireEvent.change(screen.getByLabelText("Meter test numerator"), {target:{value:"3"}});
  expect(screen.getByText("Bar 2 · Beat 1")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Meter test denominator"), {target:{value:"8"}});
  expect(screen.getByText(/Plays over 2 quarter-note song beats/)).toBeTruthy();
  expect((screen.getByLabelText("Pattern length") as HTMLSelectElement).value).toBe("4");
});
it("keeps speed advanced, shows nonnormal speed, and explains capacity across all pads", () => {
  const view = render(<Editor controller/>);
  const details = view.container.querySelector("details")!;
  expect(details.open).toBe(false);
  expect((screen.getByRole("option",{name:/6 per beat/}) as HTMLOptionElement).disabled).toBe(true);
  expect(screen.getByText(/exceed 128 steps/)).toBeTruthy();
  details.open = true;
  fireEvent(details, new Event("toggle"));
  fireEvent.change(screen.getByLabelText("Playback speed"),{target:{value:"3:2"}});
  expect(screen.getByText("Playback speed: 1.5× (3:2)")).toBeTruthy();
  expect(screen.getByText(/Plays over 2.667 quarter-note song beats/)).toBeTruthy();
});
for (const language of ["german","french","spanish"] as const) it(`renders localized timing in ${language}`, () => {
  const view = render(<Editor language={language}/>);
  expect(view.container.textContent).not.toContain("Pattern length");
  expect(view.container.querySelectorAll('[data-beat-group]')).toHaveLength(4);
});
