import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createRoot } from "react-dom/client";

import { ClassicPreset, NodeEditor } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { Presets as ReactPresets, ReactPlugin } from "rete-react-plugin";

import {
  formulaTargetKey,
  readInputFormulaMap,
  setInputFormulaConfig,
  tokenizeGraphFormula,
  validateGraphFormulaExpression,
  type GraphFormulaToken,
  type InputFormulaBinding
} from "../lib/graphFormula";
import { getDraggedOpcodeName, hasDraggedOpcode } from "../lib/opcodeDragDrop";
import type { Connection, GuiLanguage, NodePosition, OpcodeSpec, PatchGraph, SignalType } from "../types";

type EditorHandle = {
  destroy: () => void;
};

export interface EditorSelection {
  nodeIds: string[];
  connections: Connection[];
}

interface ReteNodeEditorProps {
  guiLanguage: GuiLanguage;
  graph: PatchGraph;
  opcodes: OpcodeSpec[];
  viewportKey: string;
  onGraphChange: (graph: PatchGraph) => void;
  onSelectionChange: (selection: EditorSelection) => void;
  onAddOpcodeAtPosition?: (opcode: OpcodeSpec, position: NodePosition) => void;
  onOpcodeHelpRequest?: (opcodeName: string) => void;
  opcodeHelpLabel?: string;
  onDeleteSelection?: () => void;
  canDeleteSelection?: boolean;
  deleteSelectionLabel?: string;
}

type ReteEditorCopy = {
  showDocumentation: string;
  optionalInput: string;
  optionalInputWithFormula: string;
  inputWithFormula: string;
  deleteSelectedElements: string;
  selectElementsToDelete: string;
  zoomOut: string;
  zoomIn: string;
  fitFullGraphInView: string;
  fit: string;
  inputCombineFormula: string;
  inputFormulaAssistant: string;
  close: string;
  connectedInputs: string;
  insertOperator: string;
  insertNumber: string;
  numberPlaceholder: string;
  add: string;
  formula: string;
  formulaPlaceholder: string;
  tokenSelection: string;
  noTokensYet: string;
  deleteSelection: string;
  clearFormula: string;
  cancel: string;
  saveFormula: string;
  atLeastTwoSignalsForFormula: string;
  sourceLabel: string;
  sourcePrefix: string;
  opcodePrefix: string;
  portIdPrefix: string;
};

const RETE_EDITOR_COPY: Record<GuiLanguage, ReteEditorCopy> = {
  english: {
    showDocumentation: "Show documentation",
    optionalInput: "Optional input",
    optionalInputWithFormula: "Optional input. Double-click to edit combine formula.",
    inputWithFormula: "Double-click to edit combine formula.",
    deleteSelectedElements: "Delete selected elements",
    selectElementsToDelete: "Select elements to delete",
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
    fitFullGraphInView: "Fit full graph in view",
    fit: "Fit",
    inputCombineFormula: "Input combine formula",
    inputFormulaAssistant: "Input Formula Assistant",
    close: "Close",
    connectedInputs: "Connected Inputs",
    insertOperator: "Insert Operator",
    insertNumber: "Insert Number",
    numberPlaceholder: "e.g. 0.5",
    add: "Add",
    formula: "Formula",
    formulaPlaceholder: "Example: in1 + (in2 * 0.5)",
    tokenSelection: "Token Selection (click to select range)",
    noTokensYet: "No tokens yet.",
    deleteSelection: "Delete Selection",
    clearFormula: "Clear Formula",
    cancel: "Cancel",
    saveFormula: "Save Formula",
    atLeastTwoSignalsForFormula: "At least two connected signals are required to configure a combine formula.",
    sourceLabel: "Source node",
    sourcePrefix: "Source",
    opcodePrefix: "Opcode",
    portIdPrefix: "Port id"
  },
  german: {
    showDocumentation: "Dokumentation anzeigen",
    optionalInput: "Optionaler Eingang",
    optionalInputWithFormula: "Optionaler Eingang. Doppelklick zum Bearbeiten der Kombinationsformel.",
    inputWithFormula: "Doppelklick zum Bearbeiten der Kombinationsformel.",
    deleteSelectedElements: "Ausgewaehlte Elemente loeschen",
    selectElementsToDelete: "Elemente zum Loeschen auswaehlen",
    zoomOut: "Herauszoomen",
    zoomIn: "Hereinzoomen",
    fitFullGraphInView: "Gesamten Graph einpassen",
    fit: "Einpassen",
    inputCombineFormula: "Eingangs-Kombinationsformel",
    inputFormulaAssistant: "Eingangs-Formelassistent",
    close: "Schliessen",
    connectedInputs: "Verbundene Eingaenge",
    insertOperator: "Operator einfuegen",
    insertNumber: "Zahl einfuegen",
    numberPlaceholder: "z.B. 0.5",
    add: "Hinzufuegen",
    formula: "Formel",
    formulaPlaceholder: "Beispiel: in1 + (in2 * 0.5)",
    tokenSelection: "Token-Auswahl (klicken, um Bereich zu markieren)",
    noTokensYet: "Noch keine Tokens.",
    deleteSelection: "Auswahl loeschen",
    clearFormula: "Formel loeschen",
    cancel: "Abbrechen",
    saveFormula: "Formel speichern",
    atLeastTwoSignalsForFormula:
      "Mindestens zwei verbundene Signale sind fuer eine Kombinationsformel erforderlich.",
    sourceLabel: "Quell-Node",
    sourcePrefix: "Quelle",
    opcodePrefix: "Opcode",
    portIdPrefix: "Port-ID"
  },
  french: {
    showDocumentation: "Afficher la documentation",
    optionalInput: "Entree optionnelle",
    optionalInputWithFormula: "Entree optionnelle. Double-clic pour editer la formule de combinaison.",
    inputWithFormula: "Double-clic pour editer la formule de combinaison.",
    deleteSelectedElements: "Supprimer les elements selectionnes",
    selectElementsToDelete: "Selectionnez des elements a supprimer",
    zoomOut: "Zoom arriere",
    zoomIn: "Zoom avant",
    fitFullGraphInView: "Adapter tout le graphe",
    fit: "Ajuster",
    inputCombineFormula: "Formule de combinaison d'entree",
    inputFormulaAssistant: "Assistant de formule d'entree",
    close: "Fermer",
    connectedInputs: "Entrees connectees",
    insertOperator: "Inserer operateur",
    insertNumber: "Inserer nombre",
    numberPlaceholder: "ex. 0.5",
    add: "Ajouter",
    formula: "Formule",
    formulaPlaceholder: "Exemple: in1 + (in2 * 0.5)",
    tokenSelection: "Selection de tokens (cliquer pour selectionner une plage)",
    noTokensYet: "Aucun token pour le moment.",
    deleteSelection: "Supprimer la selection",
    clearFormula: "Effacer formule",
    cancel: "Annuler",
    saveFormula: "Enregistrer formule",
    atLeastTwoSignalsForFormula:
      "Au moins deux signaux connectes sont requis pour definir une formule de combinaison.",
    sourceLabel: "Noeud source",
    sourcePrefix: "Source",
    opcodePrefix: "Opcode",
    portIdPrefix: "ID port"
  },
  spanish: {
    showDocumentation: "Mostrar documentacion",
    optionalInput: "Entrada opcional",
    optionalInputWithFormula: "Entrada opcional. Doble clic para editar la formula de combinacion.",
    inputWithFormula: "Doble clic para editar la formula de combinacion.",
    deleteSelectedElements: "Eliminar elementos seleccionados",
    selectElementsToDelete: "Selecciona elementos para eliminar",
    zoomOut: "Alejar zoom",
    zoomIn: "Acercar zoom",
    fitFullGraphInView: "Ajustar grafo completo",
    fit: "Ajustar",
    inputCombineFormula: "Formula de combinacion de entrada",
    inputFormulaAssistant: "Asistente de formula de entrada",
    close: "Cerrar",
    connectedInputs: "Entradas conectadas",
    insertOperator: "Insertar operador",
    insertNumber: "Insertar numero",
    numberPlaceholder: "p.ej. 0.5",
    add: "Agregar",
    formula: "Formula",
    formulaPlaceholder: "Ejemplo: in1 + (in2 * 0.5)",
    tokenSelection: "Seleccion de tokens (clic para seleccionar rango)",
    noTokensYet: "Aun no hay tokens.",
    deleteSelection: "Eliminar seleccion",
    clearFormula: "Limpiar formula",
    cancel: "Cancelar",
    saveFormula: "Guardar formula",
    atLeastTwoSignalsForFormula:
      "Se requieren al menos dos senales conectadas para configurar una formula de combinacion.",
    sourceLabel: "Nodo fuente",
    sourcePrefix: "Fuente",
    opcodePrefix: "Opcode",
    portIdPrefix: "ID de puerto"
  }
};

const CONSTANT_OPCODES = new Set(["const_a", "const_i", "const_k"]);
const GENERATOR_CATEGORIES = new Set(["oscillator", "envelope"]);
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;

type NodePalette = {
  background: string;
  border: string;
  hover: string;
  selectedBackground: string;
  selectedBorder: string;
};

type ViewportTransform = {
  x: number;
  y: number;
  k: number;
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
  midi: {
    background: "#b9d4f5",
    border: "#7ea6d4",
    hover: "#c8def8",
    selectedBackground: "#edf5fe",
    selectedBorder: "#bdd5ef"
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

type SocketGlyphProps = {
  optional: boolean;
  title?: string;
  hasConfiguredFormula?: boolean;
  onDoubleClick?: () => void;
};

function SocketGlyph({ optional, title, hasConfiguredFormula, onDoubleClick }: SocketGlyphProps) {
  const showFormulaHighlight = hasConfiguredFormula === true;
  return (
    <div
      style={{ borderRadius: "18px", padding: "6px" }}
      onDoubleClick={(event) => {
        if (!onDoubleClick) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onDoubleClick();
      }}
    >
      <div
        title={title}
        style={{
          display: "inline-block",
          cursor: "pointer",
          border: showFormulaHighlight ? "1px solid #dcfce7" : "1px solid #f8fafc",
          borderRadius: "12px",
          width: "24px",
          height: "24px",
          verticalAlign: "middle",
          boxSizing: "border-box",
          background: showFormulaHighlight ? "#22c55e" : optional ? "rgba(148, 163, 184, 0.35)" : "#96b38a",
          opacity: showFormulaHighlight ? 1 : optional ? 0.62 : 1,
          boxShadow: showFormulaHighlight ? "0 0 0 2px rgba(34, 197, 94, 0.35)" : "none"
        }}
      />
    </div>
  );
}

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
  if (category === "midi") {
    return CATEGORY_NODE_PALETTES.midi;
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

function sourceBindingKey(fromNodeId: string, fromPortId: string): string {
  return `${fromNodeId}|${fromPortId}`;
}

interface FormulaEditorInput {
  token: string;
  fromNodeId: string;
  fromPortId: string;
  label: string;
  details: string;
}

interface FormulaEditorState {
  targetNodeId: string;
  targetNodeLabel: string;
  targetPortId: string;
  targetPortLabel: string;
  expression: string;
  inputs: FormulaEditorInput[];
  selectionStart: number;
  selectionEnd: number;
}

function nextAvailableToken(existing: Set<string>): string {
  let index = 1;
  while (existing.has(`in${index}`)) {
    index += 1;
  }
  return `in${index}`;
}

function sourceLabelForConnection(
  connection: Connection,
  graph: PatchGraph,
  opcodeByName: Map<string, OpcodeSpec>,
  copy: Pick<ReteEditorCopy, "sourceLabel" | "sourcePrefix" | "opcodePrefix" | "portIdPrefix">
): { label: string; details: string } {
  const sourceNode = graph.nodes.find((node) => node.id === connection.from_node_id);
  if (!sourceNode) {
    return {
      label: `${connection.from_node_id}.${connection.from_port_id}`,
      details: `${copy.sourceLabel} ${connection.from_node_id}.${connection.from_port_id}`
    };
  }
  const sourceSpec = opcodeByName.get(sourceNode.opcode);
  const sourcePortLabel =
    sourceSpec?.outputs.find((port) => port.id === connection.from_port_id)?.name ?? connection.from_port_id;
  const sourceOpcodeName = sourceSpec?.name ?? sourceNode.opcode;
  return {
    label: `${sourceOpcodeName} (${connection.from_port_id})`,
    details: `${copy.sourcePrefix}: ${sourceNode.id}.${sourcePortLabel}\n${copy.opcodePrefix}: ${sourceOpcodeName}\n${copy.portIdPrefix}: ${connection.from_port_id}`
  };
}

export function ReteNodeEditor({
  guiLanguage,
  graph,
  opcodes,
  viewportKey,
  onGraphChange,
  onSelectionChange,
  onAddOpcodeAtPosition,
  onOpcodeHelpRequest,
  opcodeHelpLabel,
  onDeleteSelection,
  canDeleteSelection = false,
  deleteSelectionLabel
}: ReteNodeEditorProps) {
  const copy = RETE_EDITOR_COPY[guiLanguage];
  const resolvedOpcodeHelpLabel = opcodeHelpLabel ?? copy.showDocumentation;
  const resolvedDeleteSelectionLabel = deleteSelectionLabel ?? copy.deleteSelectedElements;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initializingRef = useRef(false);
  const graphRef = useRef(graph);
  const areaRef = useRef<AreaPlugin<any, any> | null>(null);
  const editorRef = useRef<NodeEditor<any> | null>(null);
  const reteToPatchRef = useRef<Map<string, string>>(new Map());
  const viewportByKeyRef = useRef<Map<string, ViewportTransform>>(new Map());
  const formulaEditorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [isOpcodeDragOver, setIsOpcodeDragOver] = useState(false);
  const [formulaEditor, setFormulaEditor] = useState<FormulaEditorState | null>(null);
  const [formulaNumberDraft, setFormulaNumberDraft] = useState("1");

  const opcodeByName = useMemo(() => new Map(opcodes.map((opcode) => [opcode.name, opcode])), [opcodes]);
  const configuredFormulaTargetKeys = useMemo(
    () => Object.keys(readInputFormulaMap(graph.ui_layout)).sort(),
    [graph.ui_layout]
  );
  const configuredFormulaTargetKeySet = useMemo(
    () => new Set(configuredFormulaTargetKeys),
    [configuredFormulaTargetKeys]
  );
  const formulaSocketHighlightKey = configuredFormulaTargetKeys.join(";");

  const updateGraph = useCallback(
    (updater: (current: PatchGraph) => PatchGraph) => {
      const next = updater(graphRef.current);
      graphRef.current = next;
      onGraphChange(next);
    },
    [onGraphChange]
  );

  const openFormulaEditor = useCallback(
    (targetNodeId: string, targetPortId: string) => {
      const graphState = graphRef.current;
      const targetNode = graphState.nodes.find((node) => node.id === targetNodeId);
      if (!targetNode) {
        return;
      }

      const targetSpec = opcodeByName.get(targetNode.opcode);
      const targetPortLabel = targetSpec?.inputs.find((input) => input.id === targetPortId)?.name ?? targetPortId;
      const targetNodeLabel = targetSpec?.name ?? targetNode.opcode;

      const inboundConnections = graphState.connections.filter(
        (connection) => connection.to_node_id === targetNodeId && connection.to_port_id === targetPortId
      );

      const formulaMap = readInputFormulaMap(graphState.ui_layout);
      const targetKey = formulaTargetKey(targetNodeId, targetPortId);
      const storedFormula = formulaMap[targetKey];

      const availableBySource = new Map<string, Connection>();
      for (const connection of inboundConnections) {
        availableBySource.set(sourceBindingKey(connection.from_node_id, connection.from_port_id), connection);
      }

      const usedSources = new Set<string>();
      const usedTokens = new Set<string>();
      const inputs: FormulaEditorInput[] = [];

      if (storedFormula?.inputs?.length) {
        for (const binding of storedFormula.inputs) {
          const sourceKey = sourceBindingKey(binding.from_node_id, binding.from_port_id);
          const connection = availableBySource.get(sourceKey);
          if (!connection || usedSources.has(sourceKey) || usedTokens.has(binding.token)) {
            continue;
          }
          const sourceLabel = sourceLabelForConnection(connection, graphState, opcodeByName, copy);
          usedSources.add(sourceKey);
          usedTokens.add(binding.token);
          inputs.push({
            token: binding.token,
            fromNodeId: binding.from_node_id,
            fromPortId: binding.from_port_id,
            label: sourceLabel.label,
            details: sourceLabel.details
          });
        }
      }

      for (const connection of inboundConnections) {
        const sourceKey = sourceBindingKey(connection.from_node_id, connection.from_port_id);
        if (usedSources.has(sourceKey)) {
          continue;
        }
        const token = nextAvailableToken(usedTokens);
        const sourceLabel = sourceLabelForConnection(connection, graphState, opcodeByName, copy);
        usedSources.add(sourceKey);
        usedTokens.add(token);
        inputs.push({
          token,
          fromNodeId: connection.from_node_id,
          fromPortId: connection.from_port_id,
          label: sourceLabel.label,
          details: sourceLabel.details
        });
      }

      const defaultExpression = inputs.map((input) => input.token).join(" + ");
      const expression = typeof storedFormula?.expression === "string" ? storedFormula.expression : defaultExpression;
      const initialExpression = expression.trim().length > 0 ? expression : defaultExpression;

      setFormulaNumberDraft("1");
      setFormulaEditor({
        targetNodeId,
        targetNodeLabel,
        targetPortId,
        targetPortLabel,
        expression: initialExpression,
        inputs,
        selectionStart: initialExpression.length,
        selectionEnd: initialExpression.length
      });

      requestAnimationFrame(() => {
        const textarea = formulaEditorTextareaRef.current;
        if (!textarea) {
          return;
        }
        textarea.focus();
        textarea.setSelectionRange(initialExpression.length, initialExpression.length);
      });
    },
    [copy, opcodeByName]
  );

  const formulaValidation = useMemo(() => {
    if (!formulaEditor) {
      return null;
    }
    const tokenSet = new Set(formulaEditor.inputs.map((input) => input.token));
    const baseValidation = validateGraphFormulaExpression(formulaEditor.expression, tokenSet);
    return {
      isValid: baseValidation.isValid,
      errors: [...baseValidation.errors],
      tokens: baseValidation.tokens
    };
  }, [formulaEditor]);

  const formulaTokens = useMemo<GraphFormulaToken[]>(() => {
    if (!formulaEditor) {
      return [];
    }
    return tokenizeGraphFormula(formulaEditor.expression).tokens;
  }, [formulaEditor]);

  const canInsertFormulaNumber = useMemo(() => {
    const normalized = formulaNumberDraft.trim();
    return /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(normalized);
  }, [formulaNumberDraft]);

  const insertFormulaFragment = useCallback((fragment: string) => {
    setFormulaEditor((current) => {
      if (!current) {
        return current;
      }
      const start = Math.max(0, Math.min(current.selectionStart, current.expression.length));
      const end = Math.max(0, Math.min(current.selectionEnd, current.expression.length));
      const nextExpression = `${current.expression.slice(0, start)}${fragment}${current.expression.slice(end)}`;
      const nextCaret = start + fragment.length;

      requestAnimationFrame(() => {
        const textarea = formulaEditorTextareaRef.current;
        if (!textarea) {
          return;
        }
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
      });

      return {
        ...current,
        expression: nextExpression,
        selectionStart: nextCaret,
        selectionEnd: nextCaret
      };
    });
  }, []);

  const deleteFormulaSelection = useCallback(() => {
    setFormulaEditor((current) => {
      if (!current) {
        return current;
      }

      const start = Math.max(0, Math.min(current.selectionStart, current.expression.length));
      const end = Math.max(0, Math.min(current.selectionEnd, current.expression.length));
      if (start === 0 && end === 0) {
        return current;
      }

      const deleteFrom = start === end ? Math.max(0, start - 1) : start;
      const deleteTo = start === end ? start : end;
      const nextExpression = `${current.expression.slice(0, deleteFrom)}${current.expression.slice(deleteTo)}`;
      const nextCaret = deleteFrom;

      requestAnimationFrame(() => {
        const textarea = formulaEditorTextareaRef.current;
        if (!textarea) {
          return;
        }
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
      });

      return {
        ...current,
        expression: nextExpression,
        selectionStart: nextCaret,
        selectionEnd: nextCaret
      };
    });
  }, []);

  const selectFormulaRange = useCallback((start: number, end: number) => {
    setFormulaEditor((current) => {
      if (!current) {
        return current;
      }
      const nextStart = Math.max(0, Math.min(start, current.expression.length));
      const nextEnd = Math.max(nextStart, Math.min(end, current.expression.length));

      requestAnimationFrame(() => {
        const textarea = formulaEditorTextareaRef.current;
        if (!textarea) {
          return;
        }
        textarea.focus();
        textarea.setSelectionRange(nextStart, nextEnd);
      });

      return {
        ...current,
        selectionStart: nextStart,
        selectionEnd: nextEnd
      };
    });
  }, []);

  const saveFormulaEditor = useCallback(() => {
    if (!formulaEditor || !formulaValidation?.isValid) {
      return;
    }

    const targetKey = formulaTargetKey(formulaEditor.targetNodeId, formulaEditor.targetPortId);
    const bindings: InputFormulaBinding[] = formulaEditor.inputs.map((input) => ({
      token: input.token,
      from_node_id: input.fromNodeId,
      from_port_id: input.fromPortId
    }));
    const expression = formulaEditor.expression.trim();

    updateGraph((currentGraph) => ({
      ...currentGraph,
      ui_layout: setInputFormulaConfig(currentGraph.ui_layout, targetKey, { expression, inputs: bindings })
    }));
    setFormulaEditor(null);
  }, [formulaEditor, formulaValidation?.isValid, updateGraph]);

  const clearFormulaEditor = useCallback(() => {
    if (!formulaEditor) {
      return;
    }

    const targetKey = formulaTargetKey(formulaEditor.targetNodeId, formulaEditor.targetPortId);
    updateGraph((currentGraph) => ({
      ...currentGraph,
      ui_layout: setInputFormulaConfig(currentGraph.ui_layout, targetKey, null)
    }));
    setFormulaEditor(null);
  }, [formulaEditor, updateGraph]);

  useEffect(() => {
    if (!formulaEditor) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFormulaEditor(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [formulaEditor]);

  const syncZoomPercent = useCallback(() => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    setZoomPercent(Math.round(area.area.transform.k * 100));
  }, []);

  const zoomToViewportCenter = useCallback(
    (targetZoom: number) => {
      const area = areaRef.current;
      const container = containerRef.current;
      if (!area || !container) {
        return;
      }

      const currentZoom = area.area.transform.k;
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetZoom));
      if (Math.abs(nextZoom - currentZoom) < 0.0001) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const holderRect = area.area.content.holder.getBoundingClientRect();
      const centerClientX = containerRect.left + containerRect.width / 2;
      const centerClientY = containerRect.top + containerRect.height / 2;
      const delta = nextZoom / currentZoom - 1;
      const ox = (holderRect.left - centerClientX) * delta;
      const oy = (holderRect.top - centerClientY) * delta;

      void area.area.zoom(nextZoom, ox, oy).then((zoomed) => {
        if (zoomed !== false) {
          syncZoomPercent();
        }
      });
    },
    [syncZoomPercent]
  );

  const zoomByFactor = useCallback(
    (factor: number) => {
      const area = areaRef.current;
      if (!area) {
        return;
      }
      zoomToViewportCenter(area.area.transform.k * factor);
    },
    [zoomToViewportCenter]
  );

  const fitGraphInView = useCallback(() => {
    const area = areaRef.current;
    const editor = editorRef.current;
    const container = containerRef.current;
    if (!area || !editor || !container) {
      return;
    }

    const nodes = editor.getNodes();
    if (nodes.length === 0) {
      void area.area.translate(0, 0).then(() => {
        zoomToViewportCenter(1);
      });
      return;
    }

    void AreaExtensions.zoomAt(area, nodes).then(() => {
      syncZoomPercent();
    });
  }, [syncZoomPercent, zoomToViewportCenter]);

  const snapshotViewport = useCallback((area: AreaPlugin<any, any>): ViewportTransform => {
    const transform = area.area.transform;
    return {
      x: transform.x,
      y: transform.y,
      k: transform.k
    };
  }, []);

  const restoreViewport = useCallback(
    async (area: AreaPlugin<any, any>, viewport: ViewportTransform) => {
      const boundedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.k));
      await area.area.zoom(boundedZoom, 0, 0);
      await area.area.translate(viewport.x, viewport.y);
      syncZoomPercent();
    },
    [syncZoomPercent]
  );

  const resolveGraphPositionFromClient = useCallback((clientX: number, clientY: number): NodePosition | null => {
    const area = areaRef.current;
    const container = containerRef.current;
    if (!area || !container) {
      return null;
    }

    const rect = container.getBoundingClientRect();
    const localX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const localY = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const transform = area.area.transform;

    return {
      x: (localX - transform.x) / transform.k,
      y: (localY - transform.y) / transform.k
    };
  }, []);

  const onOpcodeDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!onAddOpcodeAtPosition) {
        return;
      }
      if (!hasDraggedOpcode(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!isOpcodeDragOver) {
        setIsOpcodeDragOver(true);
      }
    },
    [isOpcodeDragOver, onAddOpcodeAtPosition]
  );

  const onOpcodeDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!onAddOpcodeAtPosition) {
        return;
      }

      const opcodeName = getDraggedOpcodeName(event.dataTransfer);
      setIsOpcodeDragOver(false);
      if (!opcodeName) {
        return;
      }

      event.preventDefault();
      const opcode = opcodes.find((entry) => entry.name === opcodeName);
      if (!opcode) {
        return;
      }

      const position = resolveGraphPositionFromClient(event.clientX, event.clientY);
      if (!position) {
        return;
      }
      onAddOpcodeAtPosition(opcode, position);
    },
    [onAddOpcodeAtPosition, opcodes, resolveGraphPositionFromClient]
  );

  graphRef.current = graph;
  const structureKey = graphStructureKey(graph);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let cancelled = false;
    let handle: EditorHandle | undefined;

    const setup = async () => {
      if (!containerRef.current || cancelled) {
        return;
      }

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
      const optionalInputPortsByReteNode = new Map<string, Set<string>>();
      editorRef.current = editor;
      areaRef.current = area;

      render.addPreset(
        ReactPresets.classic.setup({
          customize: {
            node(context) {
              const opcodeName = String(context.payload.label);
              const spec = opcodeByName.get(opcodeName);
              const opcodeCategory = spec?.category;
              const hasDocumentation = Boolean(spec?.documentation_markdown?.trim().length);

              return function ColoredNode(props: any) {
                return (
                  <div style={{ position: "relative" }}>
                    <ReactPresets.classic.Node
                      {...props}
                      styles={(styleProps: any) => nodeCssForCategory(opcodeCategory, Boolean(styleProps.selected))}
                    />
                    {hasDocumentation && onOpcodeHelpRequest ? (
                      <button
                        type="button"
                        aria-label={`${resolvedOpcodeHelpLabel}: ${opcodeName}`}
                        title={`${resolvedOpcodeHelpLabel}: ${opcodeName}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onOpcodeHelpRequest(opcodeName);
                        }}
                        style={{
                          position: "absolute",
                          top: "6px",
                          right: "6px",
                          width: "18px",
                          height: "18px",
                          borderRadius: "999px",
                          border: "1px solid rgba(15, 23, 42, 0.8)",
                          background: "rgba(248, 250, 252, 0.92)",
                          color: "#0f172a",
                          fontWeight: 800,
                          fontSize: "12px",
                          lineHeight: "1",
                          cursor: "help",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center"
                        }}
                      >
                        ?
                      </button>
                    ) : null}
                  </div>
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
            },
            socket(context) {
              const optionalPorts = optionalInputPortsByReteNode.get(String(context.nodeId));
              const isOptionalInput = context.side === "input" && Boolean(optionalPorts?.has(context.key));
              const patchNodeId = reteToPatchRef.current.get(String(context.nodeId));
              const hasFormulaAssistant = Boolean(patchNodeId && context.side === "input");
              const hasConfiguredFormula =
                context.side === "input" && patchNodeId
                  ? configuredFormulaTargetKeySet.has(formulaTargetKey(patchNodeId, context.key))
                  : false;
              const socketTitle = hasFormulaAssistant
                ? isOptionalInput
                  ? copy.optionalInputWithFormula
                  : copy.inputWithFormula
                : isOptionalInput
                  ? copy.optionalInput
                  : undefined;
              return function StyledSocket() {
                return (
                  <SocketGlyph
                    optional={isOptionalInput}
                    title={socketTitle}
                    hasConfiguredFormula={hasConfiguredFormula}
                    onDoubleClick={
                      hasFormulaAssistant
                        ? () => {
                            if (!patchNodeId) {
                              return;
                            }
                            openFormulaEditor(patchNodeId, context.key);
                          }
                        : undefined
                    }
                  />
                );
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
      reteToPatchRef.current = reteToPatch;
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
              new ClassicPreset.Input(socketForType(sockets, input.signal_type), input.name, true)
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

        if (spec) {
          optionalInputPortsByReteNode.set(
            String(visualNode.id),
            new Set(spec.inputs.filter((input) => !input.required).map((input) => input.id))
          );
        }

        // Register the patch<->Rete id mapping before the node is added so socket
        // customization can resolve formula metadata on the first render pass.
        patchToRete.set(node.id, visualNode);
        reteToPatch.set(String(visualNode.id), node.id);

        await editor.addNode(visualNode);
        await area.translate(visualNode.id, { x: node.position.x, y: node.position.y });
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

        if (context.type === "connectionremove") {
          // Prevent accidental edge deletion from socket interaction.
          // Connections should only be removed via explicit selection + delete action.
          return;
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

        if (context.type === "zoomed") {
          setZoomPercent(Math.round(context.data.zoom * 100));
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

      const savedViewport = viewportByKeyRef.current.get(viewportKey);
      if (savedViewport) {
        await restoreViewport(area, savedViewport);
      } else {
        await AreaExtensions.zoomAt(area, editor.getNodes());
        syncZoomPercent();
      }
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
      const liveArea = areaRef.current;
      if (liveArea) {
        viewportByKeyRef.current.set(viewportKey, snapshotViewport(liveArea));
      }
      handle?.destroy();
      areaRef.current = null;
      editorRef.current = null;
      reteToPatchRef.current = new Map();
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [
    copy,
    onOpcodeHelpRequest,
    onSelectionChange,
    resolvedOpcodeHelpLabel,
    structureKey,
    formulaSocketHighlightKey,
    viewportKey,
    syncZoomPercent,
    snapshotViewport,
    restoreViewport,
    openFormulaEditor,
    opcodeByName,
    configuredFormulaTargetKeySet,
    updateGraph
  ]);

  return (
    <>
      <div
        className={`relative h-full w-full rounded-2xl border bg-slate-950/75 ${
          isOpcodeDragOver ? "border-accent/80 ring-2 ring-accent/50" : "border-slate-700/70"
        }`}
        onDragOver={onOpcodeDragOver}
        onDrop={onOpcodeDrop}
        onDragLeave={() => setIsOpcodeDragOver(false)}
      >
        <div ref={containerRef} className="h-full w-full" />
        {onDeleteSelection ? (
          <button
            type="button"
            onClick={onDeleteSelection}
            disabled={!canDeleteSelection}
            aria-label={resolvedDeleteSelectionLabel}
            title={canDeleteSelection ? resolvedDeleteSelectionLabel : copy.selectElementsToDelete}
            className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-600/70 bg-rose-950/70 text-rose-200 transition enabled:hover:bg-rose-900/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={1.9}>
              <path d="M4 7h16" />
              <path d="M9 7V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V7" />
              <path d="M6.2 7l.9 12.3A1.8 1.8 0 0 0 8.9 21h6.2a1.8 1.8 0 0 0 1.8-1.7L17.8 7" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
        ) : null}
        <div className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-2">
          <div className="pointer-events-none rounded-md border border-slate-700/90 bg-slate-950/90 px-2 py-1 font-mono text-[10px] text-slate-300">
            {zoomPercent}%
          </div>
          <div className="inline-flex items-center overflow-hidden rounded-lg border border-slate-700/90 bg-slate-950/95 text-xs text-slate-200 shadow-lg shadow-black/40">
            <button
              type="button"
              onClick={() => zoomByFactor(0.9)}
              className="h-7 w-7 border-r border-slate-700/80 transition hover:bg-slate-800"
              aria-label={copy.zoomOut}
              title={copy.zoomOut}
            >
              -
            </button>
            <button
              type="button"
              onClick={() => zoomByFactor(1.1)}
              className="h-7 w-7 border-r border-slate-700/80 transition hover:bg-slate-800"
              aria-label={copy.zoomIn}
              title={copy.zoomIn}
            >
              +
            </button>
            <button
              type="button"
              onClick={fitGraphInView}
              className="h-7 px-2 font-semibold uppercase tracking-[0.12em] transition hover:bg-slate-800"
              aria-label={copy.fitFullGraphInView}
              title={copy.fitFullGraphInView}
            >
              {copy.fit}
            </button>
          </div>
        </div>
      </div>

      {formulaEditor && (
        <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-slate-950/75 p-4" onMouseDown={() => setFormulaEditor(null)}>
          <section
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={copy.inputCombineFormula}
          >
            <header className="flex items-start justify-between gap-3 border-b border-slate-700 px-4 py-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-100">{copy.inputFormulaAssistant}</h2>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                  {formulaEditor.targetNodeId}.{formulaEditor.targetPortId} ({formulaEditor.targetNodeLabel} / {formulaEditor.targetPortLabel})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormulaEditor(null)}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400"
              >
                {copy.close}
              </button>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[280px_1fr]">
              <aside className="space-y-3">
                <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{copy.connectedInputs}</div>
                  <div className="space-y-2">
                    {formulaEditor.inputs.map((input) => (
                      <div key={`${input.token}-${input.fromNodeId}-${input.fromPortId}`} className="group relative">
                        <button
                          type="button"
                          onClick={() => insertFormulaFragment(input.token)}
                          title={input.details}
                          className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-left text-xs text-slate-200 transition hover:border-accent/70 hover:text-accent"
                        >
                          <span className="font-mono text-accent">{input.token}</span>
                          <span className="truncate">{input.label}</span>
                        </button>
                        <div className="pointer-events-none absolute left-0 right-0 top-full z-20 mt-1 hidden rounded-md border border-slate-600 bg-slate-950/95 px-2 py-1 text-[11px] leading-relaxed text-slate-200 shadow-lg group-hover:block group-focus-within:block whitespace-pre-line">
                          {input.details}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{copy.insertOperator}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {["+", "-", "*", "/", "(", ")"].map((operator) => (
                      <button
                        key={`op-${operator}`}
                        type="button"
                        onClick={() => insertFormulaFragment(` ${operator} `)}
                        className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-sm text-slate-200 transition hover:border-accent/70 hover:text-accent"
                      >
                        {operator}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{copy.insertNumber}</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={formulaNumberDraft}
                      onChange={(event) => setFormulaNumberDraft(event.target.value)}
                      className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring"
                      placeholder={copy.numberPlaceholder}
                    />
                    <button
                      type="button"
                      disabled={!canInsertFormulaNumber}
                      onClick={() => {
                        if (!canInsertFormulaNumber) {
                          return;
                        }
                        insertFormulaFragment(formulaNumberDraft.trim());
                      }}
                      className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-200 transition hover:border-accent/70 hover:text-accent disabled:opacity-40"
                    >
                      {copy.add}
                    </button>
                  </div>
                </div>
              </aside>

              <section className="flex min-h-0 flex-col gap-3">
                <label className="flex min-h-0 flex-1 flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{copy.formula}</span>
                  <textarea
                    ref={formulaEditorTextareaRef}
                    value={formulaEditor.expression}
                    onChange={(event) => {
                      const next = event.target.value;
                      setFormulaEditor((current) =>
                        current
                          ? {
                              ...current,
                              expression: next,
                              selectionStart: event.target.selectionStart ?? next.length,
                              selectionEnd: event.target.selectionEnd ?? next.length
                            }
                          : current
                      );
                    }}
                    onSelect={(event) => {
                      const target = event.target as HTMLTextAreaElement;
                      setFormulaEditor((current) =>
                        current
                          ? {
                              ...current,
                              selectionStart: target.selectionStart ?? current.selectionStart,
                              selectionEnd: target.selectionEnd ?? current.selectionEnd
                            }
                          : current
                      );
                    }}
                    className={`min-h-[180px] w-full rounded-lg border bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring ${
                      formulaValidation?.isValid ? "border-slate-600" : "border-rose-500/70"
                    }`}
                    placeholder={copy.formulaPlaceholder}
                  />
                </label>

                <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    {copy.tokenSelection}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {formulaTokens.length > 0 ? (
                      formulaTokens.map((token, index) => (
                        <button
                          key={`formula-token-${index}-${token.start}`}
                          type="button"
                          onClick={() => selectFormulaRange(token.start, token.end)}
                          className={`rounded border px-2 py-1 font-mono text-xs transition ${
                            token.type === "identifier"
                              ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                              : token.type === "number"
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                                : "border-slate-700 bg-slate-900 text-slate-300"
                          }`}
                        >
                          {token.value}
                        </button>
                      ))
                    ) : (
                      <div className="text-xs text-slate-500">{copy.noTokensYet}</div>
                    )}
                  </div>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={deleteFormulaSelection}
                      className="rounded-md border border-rose-500/60 bg-rose-950/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-rose-200 transition hover:bg-rose-900/40"
                    >
                      {copy.deleteSelection}
                    </button>
                  </div>
                </div>

                {!formulaValidation?.isValid && formulaValidation?.errors.length ? (
                  <div className="rounded-xl border border-rose-500/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                    {formulaValidation.errors.map((error, index) => (
                      <div key={`formula-error-${index}`}>- {error}</div>
                    ))}
                  </div>
                ) : null}
              </section>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-700 px-4 py-3">
              <button
                type="button"
                onClick={clearFormulaEditor}
                className="rounded-lg border border-amber-500/60 bg-amber-950/35 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-amber-200 transition hover:bg-amber-900/40"
              >
                {copy.clearFormula}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFormulaEditor(null)}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400"
                >
                  {copy.cancel}
                </button>
                <button
                  type="button"
                  disabled={!formulaValidation?.isValid}
                  onClick={saveFormulaEditor}
                  className="rounded-lg border border-accent/70 bg-accent/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/30 disabled:opacity-40"
                >
                  {copy.saveFormula}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
