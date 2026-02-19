# Graph Editor

## Purpose
The graph editor is the visual patching surface for building CSound instruments from opcode nodes.
It supports node placement, wiring typed signals, parameter editing, and compile-ready graph persistence.

## Existing Functionality

### Canvas and Navigation
- Pan/zoom node canvas (Rete.js area plugin).
- Zoom controls:
  - zoom out
  - zoom in
  - fit graph in viewport
- Zoom percentage indicator.

### Node Authoring
- Add opcodes by drag/drop from catalog onto canvas.
- Nodes keep persisted positions (`graph.nodes[].position`).
- Constant nodes (`const_a`, `const_i`, `const_k`) expose inline editable `value` control.
- Node cards are category-colored for faster visual grouping.
- Optional inputs are visually distinguished on sockets.
- Opcode docs button (`?`) opens documentation modal when available.

### Connections and Selection
- Create/remove connections between compatible sockets.
- Multiple selection for nodes/connections via Ctrl accumulate.
- Connection click selection with visual highlight.
- Background click clears selection.
- Selected elements can be deleted from the main app controls.
- Socket interaction does not remove existing connections (prevents accidental deletion while editing formulas).
- Connection removal is intentional: select connection(s) then delete from app controls.

### Type and Compile Safety
- Connection type compatibility is validated by backend compiler.
- Graph compilation emits deterministic CSound variables and opcode lines.
- Required inputs must be connected or have defaults.
- Cycles are rejected unless explicitly broken by suitable opcodes.

## New Functionality: Input Formula Assistant

### Trigger
- Double-click an **input connector** to open the formula assistant for that specific target input.

### Use Case
- When multiple source signals are patched into the same input, define how they are combined before compile.

### Formula Features
- Available source inputs are provided as insertable tokens (for example `in1`, `in2`, ...).
- Supported operators and syntax:
  - `+`, `-`, `*`, `/`
  - parentheses `(` and `)`
  - integer and floating-point literals
- Formula can be edited in two ways:
  - direct text editing
  - token/operator/number insertion and token-range selection + delete

### Validation
- Formula is validated before save.
- Validation checks include:
  - non-empty expression
  - balanced and valid parentheses/expression grammar
  - valid tokens
  - only known input tokens allowed
  - at least two connected signals for combine formula workflows
- Errors are highlighted in the assistant and Save is blocked until valid.

### Persistence
- Formulas are stored in `graph.ui_layout.input_formulas`.
- Key format:
  - `<to_node_id>::<to_port_id>`
- Value format:
  - `expression` (string)
  - `inputs[]` bindings:
    - `token`
    - `from_node_id`
    - `from_port_id`

## Compile Integration (CSound)
- Backend compiler now supports multiple inbound connections for a single input port.
- For multi-input targets:
  - if formula exists: compiler resolves token bindings and compiles that expression
  - if no formula exists: compiler falls back to summing inbound signals in connection order
- Formula parsing is validated backend-side as well (safe grammar/token checks).
- Invalid formulas fail compile with diagnostics that point to the target input.

## Notes
- Backend remains source-of-truth for compile validation.
- UI formulas are metadata in `ui_layout`; node/connection topology remains in canonical graph arrays.
