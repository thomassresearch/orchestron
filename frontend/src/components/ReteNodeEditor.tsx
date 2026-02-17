import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

import { ClassicPreset, NodeEditor } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { Presets as ReactPresets, ReactPlugin } from "rete-react-plugin";

import type { Connection, OpcodeSpec, PatchGraph, SignalType } from "../types";

type EditorHandle = {
  destroy: () => void;
};

export interface EditorSelection {
  nodeIds: string[];
  connections: Connection[];
}

interface ReteNodeEditorProps {
  graph: PatchGraph;
  opcodes: OpcodeSpec[];
  onGraphChange: (graph: PatchGraph) => void;
  onSelectionChange: (selection: EditorSelection) => void;
}

const CONSTANT_OPCODES = new Set(["const_a", "const_i", "const_k"]);
const GENERATOR_CATEGORIES = new Set(["oscillator", "midi", "envelope"]);

type NodePalette = {
  background: string;
  border: string;
  hover: string;
  selectedBackground: string;
  selectedBorder: string;
};

const CATEGORY_NODE_PALETTES: Record<string, NodePalette> = {
  generator: {
    background: "#b8dcc4",
    border: "#7aa58a",
    hover: "#c8e6d1",
    selectedBackground: "#ecf8f0",
    selectedBorder: "#b7dec3"
  },
  filter: {
    background: "#e9b8be",
    border: "#bf7f88",
    hover: "#f0c8cd",
    selectedBackground: "#fdf0f2",
    selectedBorder: "#eebac0"
  },
  constant: {
    background: "#c8cdd6",
    border: "#8f98a8",
    hover: "#d5d9e1",
    selectedBackground: "#f2f4f7",
    selectedBorder: "#cfd4dd"
  },
  default: {
    background: "#b8cce6",
    border: "#7c97bd",
    hover: "#c7d8ee",
    selectedBackground: "#ecf2fb",
    selectedBorder: "#bfd0e7"
  }
};

const CONSTANT_INPUT_CSS = `
  color-scheme: light;
  background: #ffffff !important;
  color: #000000 !important;
  -webkit-text-fill-color: #000000 !important;
  border: 1px solid #475569 !important;
  opacity: 1 !important;
  font-size: 14px !important;
  font-weight: 700 !important;
  line-height: 1.2 !important;
  caret-color: #000000 !important;
  &::placeholder {
    color: #64748b !important;
    opacity: 1 !important;
  }
`;

function socketForType(sockets: Record<SignalType, ClassicPreset.Socket>, type: SignalType) {
  return sockets[type];
}

function connectionKey(connection: Connection): string {
  return `${connection.from_node_id}|${connection.from_port_id}|${connection.to_node_id}|${connection.to_port_id}`;
}

function paletteForCategory(category: string | undefined): NodePalette {
  if (!category) {
    return CATEGORY_NODE_PALETTES.default;
  }
  if (GENERATOR_CATEGORIES.has(category)) {
    return CATEGORY_NODE_PALETTES.generator;
  }
  if (category === "filter") {
    return CATEGORY_NODE_PALETTES.filter;
  }
  if (category === "constants") {
    return CATEGORY_NODE_PALETTES.constant;
  }
  return CATEGORY_NODE_PALETTES.default;
}

function nodeCssForCategory(category: string | undefined, selected: boolean): string {
  const palette = paletteForCategory(category);
  const background = selected ? palette.selectedBackground : palette.background;
  const border = selected ? palette.selectedBorder : palette.border;
  return `
    background: ${background};
    border-color: ${border};
    &:hover {
      background: ${palette.hover};
    }
    ${selected ? "box-shadow: 0 0 0 3px rgba(248, 250, 252, 0.45);" : ""}
    .title, .input-title, .output-title {
      color: #0f172a;
      font-weight: 600;
    }
  `;
}

function graphStructureKey(graph: PatchGraph): string {
  const nodePart = graph.nodes.map((node) => `${node.id}:${node.opcode}`).join(";");
  const connectionPart = graph.connections
    .map(
      (connection) =>
        `${connection.from_node_id}.${connection.from_port_id}>${connection.to_node_id}.${connection.to_port_id}`
    )
    .join(";");
  return `${nodePart}|${connectionPart}`;
}

export function ReteNodeEditor({ graph, opcodes, onGraphChange, onSelectionChange }: ReteNodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initializingRef = useRef(false);
  const graphRef = useRef(graph);

  graphRef.current = graph;
  const structureKey = graphStructureKey(graph);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let cancelled = false;
    let handle: EditorHandle | undefined;

    const opcodeByName = new Map(opcodes.map((opcode) => [opcode.name, opcode]));

    const setup = async () => {
      if (!containerRef.current || cancelled) {
        return;
      }

      const updateGraph = (updater: (current: PatchGraph) => PatchGraph) => {
        const next = updater(graphRef.current);
        graphRef.current = next;
        onGraphChange(next);
      };

      const initialGraph = graphRef.current;
      initializingRef.current = true;

      const sockets: Record<SignalType, ClassicPreset.Socket> = {
        a: new ClassicPreset.Socket("audio"),
        k: new ClassicPreset.Socket("control"),
        i: new ClassicPreset.Socket("init"),
        S: new ClassicPreset.Socket("string"),
        f: new ClassicPreset.Socket("ftable")
      };

      const editor = new NodeEditor<any>();
      const area = new AreaPlugin<any, any>(containerRef.current);
      const connection = new ConnectionPlugin<any, any>();
      const render = new ReactPlugin<any, any>({ createRoot });

      render.addPreset(
        ReactPresets.classic.setup({
          customize: {
            node(context) {
              const opcodeCategory = opcodeByName.get(context.payload.label)?.category;
              return function ColoredNode(props: any) {
                return (
                  <ReactPresets.classic.Node
                    {...props}
                    styles={(styleProps: any) => nodeCssForCategory(opcodeCategory, Boolean(styleProps.selected))}
                  />
                );
              };
            },
            control(context) {
              if (!(context.payload instanceof ClassicPreset.InputControl)) {
                return null;
              }
              return function ColoredControl(props: any) {
                return <ReactPresets.classic.InputControl {...props} styles={() => CONSTANT_INPUT_CSS} />;
              };
            }
          }
        })
      );
      connection.addPreset(ConnectionPresets.classic.setup());

      editor.use(area);
      area.use(connection);
      area.use(render);

      AreaExtensions.simpleNodesOrder(area);
      const selection = AreaExtensions.selector();
      const accumulating = AreaExtensions.accumulateOnCtrl();
      AreaExtensions.selectableNodes(area, selection, { accumulating });

      const patchToRete = new Map<string, any>();
      const reteToPatch = new Map<string, string>();
      const connectionByReteId = new Map<string, string>();
      const connectionByKey = new Map<string, Connection>();
      const selectedConnectionKeys = new Set<string>();
      const connectionHandlers = new Map<string, (event: PointerEvent) => void>();

      const emitSelection = () => {
        const nodeIds = Array.from(selection.entities.values())
          .filter((entity) => entity.label === "node")
          .map((entity) => reteToPatch.get(String(entity.id)))
          .filter((nodeId): nodeId is string => Boolean(nodeId));
        const connections = Array.from(selectedConnectionKeys)
          .map((key) => connectionByKey.get(key))
          .filter((connection): connection is Connection => Boolean(connection));

        onSelectionChange({ nodeIds, connections });
      };

      const updateConnectionClasses = () => {
        for (const [reteConnectionId, key] of connectionByReteId.entries()) {
          const view = area.connectionViews.get(reteConnectionId);
          if (!view) {
            continue;
          }

          view.element.classList.add("vs-connection-edge");
          if (selectedConnectionKeys.has(key)) {
            view.element.classList.add("vs-connection-selected");
          } else {
            view.element.classList.remove("vs-connection-selected");
          }
        }
      };

      const selectConnection = async (reteConnectionId: string, accumulate: boolean) => {
        const key = connectionByReteId.get(reteConnectionId);
        if (!key) {
          return;
        }

        if (!accumulate) {
          await selection.unselectAll();
          selectedConnectionKeys.clear();
          selectedConnectionKeys.add(key);
        } else if (selectedConnectionKeys.has(key)) {
          selectedConnectionKeys.delete(key);
        } else {
          selectedConnectionKeys.add(key);
        }

        updateConnectionClasses();
        emitSelection();
      };

      const clearConnectionSelection = () => {
        if (selectedConnectionKeys.size === 0) {
          return;
        }
        selectedConnectionKeys.clear();
        updateConnectionClasses();
      };

      const attachConnectionHandler = (reteConnectionId: string) => {
        if (connectionHandlers.has(reteConnectionId)) {
          return;
        }
        const view = area.connectionViews.get(reteConnectionId);
        if (!view) {
          return;
        }

        const handler = (event: PointerEvent) => {
          event.preventDefault();
          event.stopPropagation();
          void selectConnection(reteConnectionId, event.ctrlKey);
        };
        view.element.addEventListener("pointerdown", handler);
        connectionHandlers.set(reteConnectionId, handler);
        updateConnectionClasses();
      };

      const detachConnectionHandler = (reteConnectionId: string) => {
        const handler = connectionHandlers.get(reteConnectionId);
        const view = area.connectionViews.get(reteConnectionId);
        if (handler && view) {
          view.element.removeEventListener("pointerdown", handler);
        }
        connectionHandlers.delete(reteConnectionId);
      };

      for (const node of initialGraph.nodes) {
        const spec = opcodeByName.get(node.opcode);
        const visualNode = new ClassicPreset.Node(spec ? spec.name : node.opcode);
        const isConstantOpcode = CONSTANT_OPCODES.has(node.opcode);

        if (spec) {
          for (const input of spec.inputs) {
            visualNode.addInput(
              input.id,
              new ClassicPreset.Input(socketForType(sockets, input.signal_type), input.name)
            );
          }

          for (const output of spec.outputs) {
            visualNode.addOutput(
              output.id,
              new ClassicPreset.Output(socketForType(sockets, output.signal_type), output.name)
            );
          }
        }

        if (isConstantOpcode) {
          const initialValue = String(node.params.value ?? 0);
          visualNode.addControl(
            "value",
            new ClassicPreset.InputControl("text", {
              initial: initialValue,
              change: (nextValue: string) => {
                if (initializingRef.current) {
                  return;
                }
                updateGraph((currentGraph) => ({
                  ...currentGraph,
                  nodes: currentGraph.nodes.map((graphNode) =>
                    graphNode.id === node.id
                      ? {
                          ...graphNode,
                          params: {
                            ...graphNode.params,
                            value: nextValue.trim().length === 0 ? "0" : nextValue.trim()
                          }
                        }
                      : graphNode
                  )
                }));
              }
            })
          );
        }

        await editor.addNode(visualNode);
        await area.translate(visualNode.id, { x: node.position.x, y: node.position.y });

        patchToRete.set(node.id, visualNode);
        reteToPatch.set(String(visualNode.id), node.id);
      }

      for (const connectionDef of initialGraph.connections) {
        const source = patchToRete.get(connectionDef.from_node_id);
        const target = patchToRete.get(connectionDef.to_node_id);
        if (!source || !target) {
          continue;
        }

        try {
          const reteConnection = new ClassicPreset.Connection(
            source,
            connectionDef.from_port_id,
            target,
            connectionDef.to_port_id
          );
          const key = connectionKey(connectionDef);

          connectionByReteId.set(String(reteConnection.id), key);
          connectionByKey.set(key, connectionDef);

          await editor.addConnection(reteConnection);
          attachConnectionHandler(String(reteConnection.id));
        } catch {
          // Ignore stale/invalid persisted edges while still rendering the remaining graph.
        }
      }

      editor.addPipe((context: any) => {
        if (initializingRef.current) {
          return context;
        }

        if (context.type === "connectioncreated") {
          const created = context.data;
          const fromNode = reteToPatch.get(String(created.source));
          const toNode = reteToPatch.get(String(created.target));

          if (fromNode && toNode) {
            const createdConnection: Connection = {
              from_node_id: fromNode,
              from_port_id: created.sourceOutput,
              to_node_id: toNode,
              to_port_id: created.targetInput
            };
            const key = connectionKey(createdConnection);

            connectionByReteId.set(String(created.id), key);
            connectionByKey.set(key, createdConnection);
            attachConnectionHandler(String(created.id));

            const exists = graphRef.current.connections.some(
              (connection) =>
                connection.from_node_id === fromNode &&
                connection.from_port_id === created.sourceOutput &&
                connection.to_node_id === toNode &&
                connection.to_port_id === created.targetInput
            );

            if (!exists) {
              updateGraph((currentGraph) => ({
                ...currentGraph,
                connections: [...currentGraph.connections, createdConnection]
              }));
            }
          }
        }

        if (context.type === "connectionremoved") {
          const removed = context.data;
          const removedReteConnectionId = String(removed.id);
          const removedKey = connectionByReteId.get(removedReteConnectionId);
          if (removedKey) {
            connectionByReteId.delete(removedReteConnectionId);
            connectionByKey.delete(removedKey);
            selectedConnectionKeys.delete(removedKey);
            updateConnectionClasses();
            emitSelection();
          }
          detachConnectionHandler(removedReteConnectionId);

          const fromNode = reteToPatch.get(String(removed.source));
          const toNode = reteToPatch.get(String(removed.target));
          if (fromNode && toNode) {
            updateGraph((currentGraph) => ({
              ...currentGraph,
              connections: currentGraph.connections.filter(
                (connection) =>
                  !(
                    connection.from_node_id === fromNode &&
                    connection.from_port_id === removed.sourceOutput &&
                    connection.to_node_id === toNode &&
                    connection.to_port_id === removed.targetInput
                  )
              )
            }));
          }
        }

        return context;
      });

      area.addPipe((context: any) => {
        if (initializingRef.current) {
          return context;
        }

        if (context.type === "nodepicked") {
          if (!accumulating.active()) {
            clearConnectionSelection();
          }
          emitSelection();
          return context;
        }

        if (context.type === "pointerdown") {
          const target = context.data.event.target as HTMLElement | null;
          const clickedNode = target?.closest(".node");
          const clickedConnection = target?.closest(".vs-connection-edge");
          if (!clickedNode && !clickedConnection && !context.data.event.ctrlKey) {
            clearConnectionSelection();
            emitSelection();
          }
          return context;
        }

        if (context.type === "pointerup") {
          emitSelection();
          return context;
        }

        if (context.type === "nodetranslated") {
          const translated = context.data;
          const patchNodeId = reteToPatch.get(String(translated.id));

          if (patchNodeId) {
            updateGraph((currentGraph) => ({
              ...currentGraph,
              nodes: currentGraph.nodes.map((node) =>
                node.id === patchNodeId
                  ? {
                      ...node,
                      position: {
                        x: translated.position.x,
                        y: translated.position.y
                      }
                    }
                  : node
              )
            }));
          }
        }

        return context;
      });

      await AreaExtensions.zoomAt(area, editor.getNodes());
      initializingRef.current = false;
      emitSelection();

      handle = {
        destroy: () => {
          for (const [reteConnectionId, handler] of connectionHandlers) {
            const view = area.connectionViews.get(reteConnectionId);
            if (view) {
              view.element.removeEventListener("pointerdown", handler);
            }
          }
          accumulating.destroy();
          area.destroy();
        }
      };
    };

    void setup();

    return () => {
      cancelled = true;
      initializingRef.current = false;
      handle?.destroy();
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [opcodes, onGraphChange, onSelectionChange, structureKey]);

  return (
    <div className="h-full w-full rounded-2xl border border-slate-700/70 bg-slate-950/75">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
