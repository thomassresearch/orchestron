import type { GuiLanguage } from "../../types";
import type { SourceKind } from "../../lib/clipArranger/model";
import { sourceKeys } from "../../lib/clipArranger/migration";
import { clipButtonClass } from "./buttonStyles";
import { clipCopy } from "./copy";

export function AddArrangeTrack({ language, add }: { language: GuiLanguage; add: (kind: SourceKind) => void }) {
  const c = clipCopy(language);
  return <label className="text-xs text-slate-400">{c.newLane} <select className={clipButtonClass("add")} value="" onChange={e => add(e.target.value as SourceKind)}>
    <option value="">＋</option>{(Object.keys(sourceKeys) as SourceKind[]).map(kind => <option key={kind} value={kind}>{c[kind === "sequencer" ? "melodic" : kind]}</option>)}
  </select></label>;
}
