// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../store/useAppStore";
import { migrateClipArrangement } from "../lib/clipArranger/migration";
import { clipCopy } from "./clipArranger/copy";
import { documentationUiCopy } from "../lib/documentationUi";
import type { GuiLanguage, HelpDocId } from "../types";
import { INITIAL_PANEL_COLLAPSE_STATE } from "./CollapsiblePanel";
import { HelpDocumentationModal } from "./HelpDocumentationModal";
import { SequencerPage } from "./SequencerPage";
import type { SequencerPageProps } from "./sequencer/sequencerPageContracts";

function actions<T>(): T { return new Proxy({}, { get: () => vi.fn() }) as T; }
function Page({ language }: { language: GuiLanguage }) {
  const sequencer = useAppStore(s => s.sequencer);
  const [help, setHelp] = useState<HelpDocId | null>(null);
  return <>
    <SequencerPage onHelpRequest={setHelp} collapsedPanels={INITIAL_PANEL_COLLAPSE_STATE} onPanelCollapsedChange={() => {}}
      instrumentActions={actions()} transportActions={actions()} melodicTrackActions={actions()}
      drummerTrackActions={actions()} pianoRollActions={actions()} midiControllerActions={actions()}
      controllerSequencerActions={actions()} arpeggiatorActions={actions()} performanceActions={actions()}
      data={{ guiLanguage: language, patches: [], performances: [], instrumentBindings: [], sequencer,
        sequencerTransportSubunit: 0, currentPerformanceId: null, performanceName: "Help test", performanceDescription: "",
        instrumentsRunning: false, sessionState: "stopped", midiInputName: null, transportError: null } as SequencerPageProps["data"]} />
    {help && <HelpDocumentationModal helpDocId={help} guiLanguage={language} onClose={() => setHelp(null)} />}
  </>;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useAppStore.setState(useAppStore.getInitialState(), true);
  const sequencer = structuredClone(useAppStore.getState().sequencer);
  sequencer.tracks[0].padLoopEnabled = true;
  sequencer.tracks[0].padLoopPattern.rootSequence = [{ type: "pad", padIndex: 0 }];
  sequencer.clipArrangement = migrateClipArrangement(sequencer).model!;
  useAppStore.setState({ sequencer });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const cases = [
  ["english", "Mixer", "Multitrack Arranger", "Arrange clips and reusable content", "Feedback loops"],
  ["german", "Mischpult", "Mehrspur-Arranger", "Clips und wiederverwendbare Inhalte anordnen", "Rückkopplungsschleifen"],
  ["french", "Mixeur", "Arrangeur multipiste", "Organiser les clips et les contenus réutilisables", "Boucles audio"],
  ["spanish", "Mezclador", "Arreglador multipista", "Organizar clips y contenido reutilizable", "Bucles de audio"]
] as const;

it.each(cases)("offers explicit conversion in %s by default and hides it for the legacy override", language => {
  vi.stubEnv("VITE_CLIP_ARRANGER", undefined);
  useAppStore.setState(state => ({ sequencer: { ...state.sequencer, clipArrangement: undefined } }));
  const view = render(<Page language={language} />);
  const name = clipCopy(language).convertToClips;
  expect(screen.getByRole("button", { name })).toBeTruthy();
  expect(useAppStore.getState().sequencer.clipArrangement).toBeUndefined();
  vi.stubEnv("VITE_CLIP_ARRANGER", "0");
  view.rerender(<Page language={language} />);
  expect(screen.queryByRole("button", { name })).toBeNull();
});

it.each([undefined, "0"])("shows the clip arranger for saved clips with VITE_CLIP_ARRANGER=%s", flag => {
  vi.stubEnv("VITE_CLIP_ARRANGER", flag);
  render(<Page language="english" />);
  expect(screen.getByRole("region", { name: /Multitrack arranger/i })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Add track" })).toBeTruthy();
});

it.each(cases)("opens Mixer help in %s while expanded and collapsed without toggling or changing the mix", (language, title, _arranger, _intro, feedback) => {
  useAppStore.setState({ guiLanguage: language });
  render(<Page language={language} />);
  const ui = documentationUiCopy(language), summary = screen.getByText(title, { selector: "summary" });
  const details = summary.closest("details")!;
  const button = within(details.parentElement!).getByRole("button", { name: ui.showDocumentation });
  const before = useAppStore.getState().sequencer;
  for (const open of [true, false]) {
    act(() => { details.open = open; fireEvent(details, new Event("toggle")); });
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: title })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: feedback })).toBeTruthy();
    expect(details.open).toBe(open);
    fireEvent.click(within(dialog).getByRole("button", { name: ui.close }));
    expect(screen.queryByRole("dialog")).toBeNull();
  }
  expect(useAppStore.getState().sequencer).toBe(before);
});

it.each(cases)("opens clip-specific Arranger help in %s and dismisses it with Escape", (language, _mixer, title, intro) => {
  useAppStore.setState({ guiLanguage: language });
  render(<Page language={language} />);
  const ui = documentationUiCopy(language);
  const arranger = screen.getByRole("region", { name: new RegExp(title, "i") });
  const before = useAppStore.getState().sequencer;
  fireEvent.click(within(arranger).getByRole("button", { name: ui.showDocumentation }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: title })).toBeTruthy();
  expect(within(dialog).getByRole("heading", { name: intro })).toBeTruthy();
  expect(dialog.textContent).not.toContain("Playback source");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(useAppStore.getState().sequencer).toBe(before);
});

const rackHelpCases = [
  ["english", "Instrument Rack", "Performance Controllers", /accepts K-rate.*I-rate-only and mixed.*rack restarts.*Both CSD export modes.*fixed at initialization/],
  ["german", "Instrument-Rack", "Performance-Regler", /K-Rate.*I-Rate- und gemischte.*Rack-Neustart.*Beide CSD-Exportmodi.*Initialwerten/],
  ["french", "Rack instrument", "Réglages de performance", /K-rate.*I-rate.*mixtes.*redémarrage.*Les deux modes d’export CSD.*initialisation/],
  ["spanish", "Rack de instrumentos", "Controles de interpretación", /K-rate.*I-rate o mixtas.*reiniciar el rack.*Ambos modos de exportación CSD.*inicialización/]
] as const;

it.each(rackHelpCases)("explains continuous controller timing in %s rack help", (language, title, controllerTitle, timing) => {
  useAppStore.setState({ guiLanguage: language });
  render(<Page language={language} />);
  const rack = screen.getByRole("button", { name: title }).closest("section")!;
  const ui = documentationUiCopy(language);
  fireEvent.click(within(rack).getByRole("button", { name: ui.showDocumentation }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("heading", { name: controllerTitle })).toBeTruthy();
  expect(dialog.getByText(timing)).toBeTruthy();
  expect(dialog.queryByRole("heading", { name: /^(perf_controller|Autopanner)$/ })).toBeNull();
});
