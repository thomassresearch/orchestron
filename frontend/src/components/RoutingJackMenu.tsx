import { useState } from "react";
import { audioCopy } from "../lib/audioCopy";
import { mainPorts, MASTER, masterEndpoint, newRoute } from "../lib/audioRouting";
import { acceptsSocket, type RoutingNode, type Socket } from "../lib/routingCanvas";
import { useAppStore } from "../store/useAppStore";
import type { AudioGraph, AudioRoute, GuiLanguage, PatchListItem } from "../types";
import { InsertBypass } from "./MixerStripControls";
import { ArrangerContextMenu, type ArrangerMenuTarget } from "./sequencer/ArrangerContextMenu";
import { RoutingPatchMenu, type PatchChoice } from "./RoutingPatchMenu";

export type RouteKind = Exclude<AudioRoute["kind"], "insert">;
type DestinationMenu = { mode: "destinations" | "newEffect"; socket: Socket; kind: RouteKind };
type Subject = { mode: "kind"; socket: Socket } | DestinationMenu
  | { mode: "insert"; owner: string; index: number } | { mode: "processor"; id: string };
export type JackMenu = Subject & { target: ArrangerMenuTarget; graph: AudioGraph };
type Props = {
  menu: JackMenu; nodes: Map<string, RoutingNode>; patches: PatchListItem[]; language: GuiLanguage; running: boolean;
  exact: boolean; label: (id: string) => string; close: () => void; dismiss: (outsidePointer?: EventTarget | null) => void; change: (menu: JackMenu) => void;
  begin: (s: Socket, kind: RouteKind) => void; connect: (s: Socket) => void; addedRoute: (id: string) => void;
  insert: (owner: string, patch: string, index: number) => void; move: (owner: string, chain: string[], from: number, to: number) => void;
  edit: (id: string) => void; error: (message: string) => void;
};

/** Publish the rack instance, its input and onward connections and its silent sends in one edit. */
function createEffectDestination(
  menu: DestinationMenu & { graph: AudioGraph }, patch: PatchListItem, inputs: string[], toMaster: boolean,
  onError: (key: "instanceLimit" | "routeLimit") => void
): string | undefined {
  const state = useAppStore.getState();
  if (state.activeSessionState === "running" || state.audioGraph !== menu.graph) return;
  if (state.sequencerInstruments.length >= 64) { onError("instanceLimit"); return; }

  const { socket } = menu;
  const outputs = toMaster ? mainPorts(patch, "output") : [];
  if (menu.graph.routes.length + inputs.length + outputs.length > 1024) { onError("routeLimit"); return; }
  const id = crypto.randomUUID();
  const incoming = socket.ports.map((sourcePort, index) => newRoute({
    sourceId: socket.node, sourcePort, sourceStage: socket.stage as AudioRoute["sourceStage"],
    targetId: id, targetPort: inputs[index], targetStage: "input", kind: menu.kind
  }));
  const masterInputs = mainPorts(masterEndpoint, "input");
  const outgoing = outputs.map((sourcePort, index) => newRoute({
    sourceId: id, sourcePort, sourceStage: "strip", targetId: MASTER, targetPort: masterInputs[index], targetStage: "input", kind: "main"
  }));
  const sends = { ...state.mixer.sends };
  if (menu.kind === "send") {
    for (const route of incoming) sends[route.id] = { gainDb: null, tap: "post" };
  }
  const binding = { id, patchId: patch.id, midiChannel: 0, level: 10, effectRoutes: [], effectSourceIds: [] };
  useAppStore.setState({
    sequencerInstruments: [...state.sequencerInstruments, binding],
    audioGraph: { ...menu.graph, masterId: menu.graph.masterId ?? MASTER, routes: [...menu.graph.routes, ...incoming, ...outgoing] },
    mixer: { ...state.mixer, sends }
  });
  return incoming[0].id;
}

export function RoutingJackMenu({ menu, nodes, patches, language, exact, running, label, close, dismiss, change, begin, connect, addedRoute, insert, move, edit, error }: Props) {
  const t = audioCopy(language);
  const effects = patches.filter(p => !p.is_template && p.always_on && p.audio_inlet_names.length > 0 &&
    (menu.mode !== "insert" || p.audio_outlet_names.length > 0));
  const [routeToMaster, setRouteToMaster] = useState(true);
  const item = (title: string, act: () => void, disabled = false) => <button key={title} type="button" className="rc-menu-item" disabled={disabled} onClick={act}>{title}</button>;
  let title: string, content;
  if (menu.mode === "insert") {
    const {owner, index} = menu, chain = nodes.get(owner)!.inserts;
    const previous = nodes.get(chain[index-1] ?? owner), next = nodes.get(chain[index] ?? owner);
    title = t("addInsert") + " · " + label(previous!.id) + " → " + label(next!.id);
    if (!chain.length) title = t("addInsert") + " · " + label(owner);
    const choices = effects.map(p => ({ key: p.id, label: p.name,
      disabled: mainPorts(previous?.patch, "output").length !== mainPorts(p, "input").length ||
        mainPorts(p, "output").length !== mainPorts(next?.patch, index === chain.length ? "output" : "input").length,
      pick: () => { insert(owner, p.id, index); close(); } }));
    content = <RoutingPatchMenu choices={choices} language={language} empty={t("noEffects")}/>;
  } else if (menu.mode === "processor") {
    const id = menu.id, owner = nodes.get(menu.graph.insertOwners[id])!, i = owner?.inserts.indexOf(id) ?? -1;
    title = label(id) + (owner ? " · " + label(owner.id) : "");
    const locked = running || !owner?.serial || i < 0;
    content = <>
      {owner && <>
        {item(t("earlier"), () => {move(owner.id, owner.inserts, i, i-1); close();}, locked || i === 0)}
        {item(t("later"), () => {move(owner.id, owner.inserts, i, i+1); close();}, locked || i+1 === owner.inserts.length)}
        {!owner.serial && <p>{t("customChain")}</p>}
      </>}
      <InsertBypass id={id} name={label(id)} patch={nodes.get(id)?.patch} language={language} showStatus/>
      {item(t("edit"), () => {close(); edit(id);})}
      {item(t("removeInsert"), () => {useAppStore.getState().removeSequencerInstrument(id); close();}, running)}
    </>;
  } else {
    const s = menu.socket;
    title = label(s.node) + " · " + s.ports.join(" / ");
    if (menu.mode === "kind") {
      const kinds: RouteKind[] = s.stage === "raw" ? ["custom"] : ["main", "send", "custom"];
      content = kinds.map(kind => item(t(kind), () => {
        begin(s, kind); change({...menu, mode:"destinations", kind});
      }));
    } else if (menu.mode === "destinations") {
      title = t(menu.kind) + " · " + t("destination");
      const gesture = { mode: "add" as const, socket: s, kind: menu.kind };
      content = <>
        {item(t("chooseOnGraph"), close)}
        {item(t("newEffect"), () => change({...menu, mode:"newEffect"}))}
        {[...nodes.values()].flatMap(node => node.inputs.filter(input => acceptsSocket(gesture,input)).map(input =>
          <button className="rc-menu-item" key={JSON.stringify([node.id,input.stage,input.ports])} onClick={() => connect(input)}>
            {label(node.id)} · {input.stage === "strip" ? t("insertReturn") + " · " : ""}{input.ports.join(" / ")}
          </button>))}
      </>;
    } else {
      title = t("newEffect");
      const choices: PatchChoice[] = [];
      for (const patch of effects) {
        const groups = exact ? patch.audio_inlet_names.map(p => [p]) : [mainPorts(patch,"input")];
        const outputs = mainPorts(patch,"output"), masterInputs = mainPorts(masterEndpoint,"input");
        for (const inputs of groups.filter(ports => ports.length === s.ports.length)) {
          const master = routeToMaster && outputs.length === masterInputs.length;
          choices.push({
            key: JSON.stringify([patch.id, inputs]),
            label: patch.name + (exact ? " · " + inputs.join(" / ") : "") + " → " + t(master ? "master" : patch.has_direct_output ? "automatic" : "manualOutput"),
            pick: () => {
              const route = createEffectDestination(menu, patch, inputs, master, key => error(t(key)));
              if (route) addedRoute(route);
            }
          });
        }
      }
      content = <>
        <label className="rc-menu-option"><input type="checkbox" checked={routeToMaster} onChange={e => setRouteToMaster(e.target.checked)}/> {t("onward")} → {t("master")}</label>
        <RoutingPatchMenu choices={choices} language={language} empty={effects.length ? t("mismatch") : t("noEffects")}/>
      </>;
    }
  }
  return <ArrangerContextMenu target={menu.target} title={title} dialog dismissOnFocusLeave onClose={dismiss}>
    <div className="rc-menu"><strong>{title}</strong>{content}</div>
  </ArrangerContextMenu>;
}
