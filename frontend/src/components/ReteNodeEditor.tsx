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
const NUMERIC_LITERAL_PATTERN = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

function socketForType(sockets: Record<SignalType, ClassicPreset.Socket>, type: SignalType) {
  return sockets[type];
}

function parseNodeLiteral(value: string): string | number {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return 0;
  }
  if (NUMERIC_LITERAL_PATTERN.test(normalized)) {
    return Number(normalized);
  }
  return normalized;
}

function connectionKey(connection: Connection): string {
  return `${connection.from_node_id}|${connection.from_port_id}|${connection.to_node_id}|${connection.to_port_id}`;
}

export function ReteNodeEditor({ graph, opcodes, onGraphChange, onSelectionChange }: ReteNodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initializingRef = useRef(false);

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

      render.addPreset(ReactPresets.classic.setup());
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
          .map((entity) => entity.id);
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

      for (const node of graph.nodes) {
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
                onGraphChange({
                  ...graph,
                  nodes: graph.nodes.map((graphNode) =>
                    graphNode.id === node.id
                      ? {
                          ...graphNode,
                          params: {
                            ...graphNode.params,
                            value: parseNodeLiteral(nextValue)
                          }
                        }
                      : graphNode
                  )
                });
              }
            })
          );
        }

        await editor.addNode(visualNode);
        await area.translate(visualNode.id, { x: node.position.x, y: node.position.y });

        patchToRete.set(node.id, visualNode);
        reteToPatch.set(String(visualNode.id), node.id);
      }

      for (const connectionDef of graph.connections) {
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

            const exists = graph.connections.some(
              (connection) =>
                connection.from_node_id === fromNode &&
                connection.from_port_id === created.sourceOutput &&
                connection.to_node_id === toNode &&
                connection.to_port_id === created.targetInput
            );

            if (!exists) {
              onGraphChange({
                ...graph,
                connections: [...graph.connections, createdConnection]
              });
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
            onGraphChange({
              ...graph,
              connections: graph.connections.filter(
                (connection) =>
                  !(
                    connection.from_node_id === fromNode &&
                    connection.from_port_id === removed.sourceOutput &&
                    connection.to_node_id === toNode &&
                    connection.to_port_id === removed.targetInput
                  )
              )
            });
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
            onGraphChange({
              ...graph,
              nodes: graph.nodes.map((node) =>
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
            });
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
  }, [graph, opcodes, onGraphChange, onSelectionChange]);

  return (
    <div className="h-full w-full rounded-2xl border border-slate-700/70 bg-slate-950/75">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
