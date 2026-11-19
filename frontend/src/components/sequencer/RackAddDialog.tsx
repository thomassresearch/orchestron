import { useState } from "react";
import { api } from "../../api/client";
import { audioCopy } from "../../lib/audioCopy";
import { audioTemplate } from "../../lib/audioTemplates";
import { toPatchListItem } from "../../lib/patchCatalog";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage } from "../../types";
import { PatchBrowser } from "../PatchPicker";
import { arrangeCopy } from "../clipArranger/arrangeCopy";
import { clipButton, clipButtonClass } from "../clipArranger/buttonStyles";
import { clipCopy } from "../clipArranger/copy";
import { SEQUENCER_UI_COPY } from "./sequencerUiCopy";
import { WorkspaceDialog } from "./WorkspaceDialog";

export function RackAddDialog({ language, playableOnly = false, onAdd, onClose }: {
  language: GuiLanguage; playableOnly?: boolean; onAdd: (patchId: string) => void; onClose: () => void;
}) {
  const patches = useAppStore(s => s.patches);
  const running = useAppStore(s => s.activeSessionState === "running");
  const available = patches.filter(p => !p.is_template && (!playableOnly || !p.always_on));
  const [creating, setCreating] = useState(false);
  const choose = (id: string) => { if (!running) onAdd(id); onClose(); };
  const starter = async () => {
    const generation = useAppStore.getState().performanceWorkspaceGeneration;
    setCreating(true);
    try {
      const { description, is_template, always_on, instrument_type, schema_version, graph } = audioTemplate("instrument");
      const saved = await api.createPatch({ name: audioCopy(language)("instrument"), description, is_template, always_on, instrument_type, schema_version, graph });
      useAppStore.setState(s => ({ patches: [...s.patches.filter(p => p.id !== saved.id), toPatchListItem(saved)] }));
      if (useAppStore.getState().performanceWorkspaceGeneration === generation) choose(saved.id);
    } catch (e) { useAppStore.setState({ error: String(e) }); }
    finally { setCreating(false); }
  };
  const dismiss = () => { if (!creating) onClose(); };
  return <WorkspaceDialog title={SEQUENCER_UI_COPY[language].addInstrument} onClose={dismiss}>
    {available.length ? <PatchBrowser patches={available} guiLanguage={language} onSelectPatch={choose} onClose={dismiss} /> :
      <button className={clipButtonClass("add")} disabled={creating || running} onClick={() => void starter()}>{arrangeCopy(language).starter}</button>}
    <div className="mt-3 flex justify-end"><button className={clipButton} disabled={creating} onClick={dismiss}>{clipCopy(language).cancel}</button></div>
  </WorkspaceDialog>;
}
