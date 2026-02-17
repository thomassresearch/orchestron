import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

import { ClassicPreset, NodeEditor } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { Presets as ReactPresets, ReactPlugin } from "rete-react-plugin";

import type { OpcodeSpec, PatchGraph, SignalType } from "../types";

type EditorHandle = {
  destroy: () => void;
};

interface ReteNodeEditorProps {
  graph: PatchGraph;
  opcodes: OpcodeSpec[];
  onGraphChange: (graph: PatchGraph) => void;
}

function socketForType(sockets: Record<SignalType, ClassicPreset.Socket>, type: SignalType) {
  return sockets[type];
}

export function ReteNodeEditor({ graph, opcodes, onGraphChange }: ReteNodeEditorProps) {
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
      AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
        accumulating: AreaExtensions.accumulateOnCtrl()
      });

      const patchToRete = new Map<string, any>();
      const reteToPatch = new Map<string, string>();

      for (const node of graph.nodes) {
        const spec = opcodeByName.get(node.opcode);
        const visualNode = new ClassicPreset.Node(spec ? spec.name : node.opcode);

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
          await editor.addConnection(
            new ClassicPreset.Connection(source, connectionDef.from_port_id, target, connectionDef.to_port_id)
          );
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
                connections: [
                  ...graph.connections,
                  {
                    from_node_id: fromNode,
                    from_port_id: created.sourceOutput,
                    to_node_id: toNode,
                    to_port_id: created.targetInput
                  }
                ]
              });
            }
          }
        }

        if (context.type === "connectionremoved") {
          const removed = context.data;
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

      handle = {
        destroy: () => {
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
  }, [graph, opcodes, onGraphChange]);

  return (
    <div className="h-full w-full rounded-2xl border border-slate-700/70 bg-slate-950/75">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
