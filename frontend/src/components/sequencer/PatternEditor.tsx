import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { GuiLanguage } from "../../types";
import { RetainedScroll, type EditorOwner } from "./PerformanceEditorState";
import { arrangeCopy } from "../clipArranger/arrangeCopy";
import { WorkspacePanels } from "./WorkspacePanels";

const SettingsHost = createContext<HTMLElement | null | undefined>(undefined);

export function usePatternEditor() { return useContext(SettingsHost) !== undefined; }

/** Device controls stay attached to the same draft and handlers in both editor layouts. */
export function PatternSettings({ children }: { children: ReactNode }) {
  const host = useContext(SettingsHost);
  if (host === undefined) return <>{children}</>;
  return host && createPortal(children, host);
}

type Props = {
  language: GuiLanguage; title: string; label?: string; actions?: ReactNode; scopeLabel?: string;
  owner: EditorOwner; scrollField: string; children: ReactNode; hasSettings?: boolean; onRevealSettings?: () => void;
};

export function PatternEditor({ language, title, label, actions, scopeLabel, owner, scrollField, children, hasSettings = true, onRevealSettings }: Props) {
  const shell = useContext(WorkspacePanels);
  const [settings, setSettings] = useState(false);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const settingsId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const open = hasSettings && (settings || !!onRevealSettings);
  useLayoutEffect(() => {
    if (host && onRevealSettings) { setSettings(true); onRevealSettings(); }
  }, [host, onRevealSettings]);
  return <section className="ws-pattern-editor" aria-label={label ?? title} onKeyDown={e => {
    if (open && e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault(); setSettings(false); toggle.current?.focus();
    }
  }}>
    <header className="ws-pattern-toolbar">
      <h3 title={title}>{title}</h3>
      {scopeLabel && <button type="button" aria-expanded={open} aria-controls={settingsId} onClick={() => setSettings(!open)}>{scopeLabel}</button>}
      {actions}
      {hasSettings && <button type="button" ref={toggle} aria-controls={settingsId} aria-expanded={open} onClick={() => setSettings(!open)}>{arrangeCopy(language).settings}</button>}
      {shell?.paneActions}
    </header>
    <div id={settingsId} className="ws-pattern-settings" hidden={!open} ref={setHost} />
    <SettingsHost.Provider value={open ? host : null}>
      <RetainedScroll owner={owner} field={scrollField} className="ws-dock-scroll ws-pattern-surface" hidden={open}>{children}</RetainedScroll>
    </SettingsHost.Provider>
  </section>;
}
