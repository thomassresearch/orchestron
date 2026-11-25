import { useState } from "react";
import { audioCopy } from "../lib/audioCopy";
import type { GuiLanguage } from "../types";

export type PatchChoice = { key: string; label: string; pick: () => void; disabled?: boolean };
export function RoutingPatchMenu({ choices, language, empty }: { choices: PatchChoice[]; language: GuiLanguage; empty: string }) {
  const [query, setQuery] = useState("");
  const t = audioCopy(language);
  const filtered = choices.filter(c => c.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <input className="rc-menu-search" type="search" aria-label={t("findEffect")} placeholder={t("findEffect")} value={query} onChange={e => setQuery(e.target.value)}/>
    {filtered.map(c => <button key={c.key} className="rc-menu-item" disabled={c.disabled} onClick={c.pick} title={c.disabled ? t("insertChannels") : undefined}>{c.label}</button>)}
    {!filtered.length && <p>{choices.length ? t("noMatch") : empty}</p>}
  </>;
}
