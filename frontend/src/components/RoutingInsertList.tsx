import { useRef, useState, type PointerEvent } from "react";
import { audioCopy } from "../lib/audioCopy";
import type { RoutingNode } from "../lib/routingCanvas";
import type { AudioGraph, GuiLanguage } from "../types";

type Props = {
  node: RoutingNode; graph: AudioGraph; language: GuiLanguage; running: boolean; label: (id: string) => string;
  add: (el: HTMLButtonElement) => void; inspect: (el: HTMLButtonElement, id: string) => void;
  move: (owner: string, chain: string[], from: number, to: number) => void;
};

export function RoutingInsertList({ node, graph, language, running, label, add, inspect, move }: Props) {
  const t = audioCopy(language);
  const list = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; pointer: number; graph: AudioGraph } | null>(null);
  const [marker, setMarker] = useState<number | null>(null);
  function boundary(e: PointerEvent) {
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-insert-id]");
    if (!row || !list.current?.contains(row)) return null;
    const rect = row.getBoundingClientRect();
    return node.inserts.indexOf(row.dataset.insertId!) + Number(e.clientY >= rect.top + rect.height / 2);
  }
  function end() { drag.current = null; setMarker(null); }
  function drop(e: PointerEvent) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const at = boundary(e);
    end();
    if (running || graph !== d.graph || at === null || !node.serial) return;
    const from = node.inserts.indexOf(d.id), to = at > from ? at - 1 : at;
    if (from >= 0 && from !== to) move(node.id, node.inserts, from, to);
  }
  return <div ref={list} className="rc-insert-list" aria-label={t("processOrder")} onPointerCancel={end}>
    {node.inserts.map((id, i) => <div key={id} className="rc-insert-row" data-insert-id={id}
      data-drop={drag.current?.graph === graph && !running ? marker === i ? "before" : marker === node.inserts.length && marker === i+1 ? "after" : undefined : undefined}>
      <button type="button" className="rc-grip" disabled={running || !node.serial || node.inserts.length < 2}
        title={t("dragInsert")} aria-label={t("dragInsert") + " · " + label(id)}
        onPointerDown={e => {
          if (e.button !== 0) return;
          e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId);
          drag.current = { id, pointer: e.pointerId, graph };
        }} onPointerMove={e => { if (drag.current?.pointer === e.pointerId) setMarker(boundary(e)); }}
        onPointerUp={drop} onLostPointerCapture={end}
        onClick={e => { if (e.detail === 0) inspect(e.currentTarget, id); }}>⠿</button>
      <button type="button" className="rc-insert-name" aria-haspopup="dialog" title={label(id)} onClick={e => inspect(e.currentTarget, id)}>
        {node.serial && <span>{i+1}</span>} {label(id)} <b aria-hidden="true">⋯</b>
      </button>
    </div>)}
    <button type="button" className="rc-add-insert" disabled={running || !node.serial || !node.patch}
      title={node.serial ? t("addInsert") : t("customChain")} aria-haspopup="dialog" onClick={e => add(e.currentTarget)}>＋ {t("addInsert")}</button>
  </div>;
}
