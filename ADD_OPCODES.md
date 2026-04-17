# Add New Csound Opcodes in VisualCSound

This guide is the implementation recipe for adding opcode support.

For the canonical opcode reference, always start from the official Csound manual:
- [Csound Part Reference](https://csound.com/docs/manual/PartReference.html)

The integrated opcode documentation in the app is generated from opcode metadata plus localized manual-detail data, so this file intentionally does **not** contain a long per-opcode catalog.

## What To Change (At a Glance)

1. Find opcode details in the Csound manual.
2. Map arguments/outputs to VisualCSound signal types (`i`, `k`, `a`, `S`, `f`).
3. Add or update the opcode entry in backend metadata (`backend/app/data/opcodes.json`).
4. Set or update the opcode's `documentation_url`.
5. Choose or create an icon (`backend/app/static/icons/*.svg`) and point `icon_filename` at it.
6. Refresh localized opcode detail data from Csound manual pages.
7. Verify question-mark documentation output (EN + localized variants).
8. Add tests (API + compile behavior) and run them.

## 1) Look Up The Opcode Definition

Use the official manual page for the opcode (from Part Reference) and capture:
- Exact syntax line.
- Input arguments (name, order, optional/required).
- Output arguments.
- Allowed rates for each argument/output (`i-rate`, `k-rate`, `a-rate`, optionally `S`/`f`).
- Defaults or common defaults used by Csound examples.
- Constraints/ranges worth enforcing in metadata defaults.

Keep the original manual URL and store it in the opcode entry's `documentation_url`.

## 2) Map Csound Rates To VisualCSound Types

VisualCSound uses `SignalType` in `backend/app/models/opcode.py`:
- `i-rate` -> `SignalType.INIT` (`"i"`)
- `k-rate` -> `SignalType.CONTROL` (`"k"`)
- `a-rate` -> `SignalType.AUDIO` (`"a"`)
- string -> `SignalType.STRING` (`"S"`)
- function table -> `SignalType.FTABLE` (`"f"`)

Where allowed parameter types are defined/enforced:
- **Primary type per port**: `PortSpec.signal_type`
- **Additional accepted source types**: `PortSpec.accepted_signal_types`
- **Compatibility rules at compile time**: `backend/app/services/compiler_graph.py` in `is_compatible_type(...)`

Important behavior:
- A port with `signal_type=k` and `accepted_signal_types=[a, i]` can accept audio/control/init sources.
- Compiler currently also permits implicit `i -> k` when no explicit `accepted_signal_types` is set.

## 3) Add Opcode Metadata In Backend

Catalog file:
- `backend/app/data/opcodes.json`

Loader/facade:
- `backend/app/services/opcode_service.py`

Steps:
1. Add or update the opcode entry in `backend/app/data/opcodes.json`.
2. Define:
   - `name`, `category`, `description`, `tags`
   - `documentation_url`
   - `inputs`: `PortSpec`-shaped data (`id`, `name`, `signal_type`, `required`, `default`, `accepted_signal_types`)
   - `outputs`: `PortSpec`-shaped data
   - `template`: generated Csound line(s), using `{port_id}` placeholders
   - `icon_filename`
3. Use stable, descriptive port IDs because these are used in graph connections and templates.

Template/literal notes:
- Optional args are represented with `required=false`; compiler can omit optional placeholders when missing.
- Defaults should be conservative and musically sane.
- Keep template order exactly aligned with Csound argument order.
- `backend/app/services/opcode_service.py` should stay a loader/validator, not become handwritten catalog logic again.

## 4) Compiler And Type-Safety Checkpoints

Compiler modules:
- Facade: `backend/app/services/compiler_service.py`
- Graph validation/topology: `backend/app/services/compiler_graph.py`
- Input formulas: `backend/app/services/compiler_formula.py`
- Orchestra/CSD emission and special-node handling: `backend/app/services/compiler_orchestra.py`

Usually no compiler changes are needed for a normal opcode addition, but verify:
- The new port types are compatible with existing `is_compatible_type(...)` rules in `compiler_graph.py`.
- Optional args in template render correctly.
- Default values format safely through `_format_literal(...)` in `compiler_orchestra.py`.

If the opcode needs special behavior (custom rendering, multi-line expansion, special validation), add it in the relevant helper instead of growing the facade.

## 5) Choose Or Create An Icon

Files:
- Icon assets: `backend/app/static/icons/`
- Icon wiring: `backend/app/data/opcodes.json` via `icon_filename`

Workflow:
1. Reuse an existing family icon when appropriate (fast path).
2. If needed, add a new SVG in `backend/app/static/icons/<opcode>.svg`.
3. Keep icon style consistent with existing set (simple, high-contrast, readable at small sizes).
4. Reference it via `icon_filename` in the opcode entry.

Tip: If a dedicated icon is not ready yet, map to a category icon first and ship functionality.

## 6) Refresh Localized Manual Detail Data

The `?` button shows opcode documentation.

Data flow:
- Backend API returns `documentation_markdown` and `documentation_url` in opcode specs.
- Frontend renders this in `OpcodeDocumentationModal`.
- Detailed localized text for description/inputs/outputs comes from:
  - `frontend/src/lib/opcodeDocDetails.json`
  - generated by `tools/update_opcode_localized_docs.py`

Default workflow after adding/changing opcodes:

```bash
PYTHONUNBUFFERED=1 uv run python tools/update_opcode_localized_docs.py --opcodes "<opcode>" --output /tmp/opcodeDocDetails.changed.json
```

For multiple changed opcodes:

```bash
PYTHONUNBUFFERED=1 uv run python tools/update_opcode_localized_docs.py --opcodes "<opcode1>,<opcode2>,<opcode3>" --output /tmp/opcodeDocDetails.changed.json
```

What the script does:
1. Reads all built-in opcode specs from `OpcodeService`.
2. Fetches each referenced Csound manual page (`documentation_url`).
3. Extracts synopsis/description/initialization/performance details.
4. Maps extracted argument details to VisualCSound input/output ports.
5. Translates extracted detail text to all supported GUI languages (EN/DE/FR/ES).
6. Writes the requested output JSON.

Merge only the changed opcode entries back into `frontend/src/lib/opcodeDocDetails.json`.

Full regeneration is reserved for explicit requests:

```bash
PYTHONUNBUFFERED=1 uv run python tools/update_opcode_localized_docs.py
```

If you need a quick dry run while iterating:

```bash
uv run python tools/update_opcode_localized_docs.py --limit 5 --skip-translate --output /tmp/opcodeDocDetails.sample.json
```

Important: because this uses live manual pages and machine translation, review changed strings in the generated JSON for obvious mismatches before shipping.

## 7) Question-Mark Documentation + Multilingual Behavior

Integrated help text lives in `frontend/src/lib/documentation.ts`. Opcode localization rendering lives in `frontend/src/lib/opcodeDocumentation.ts` and is generated for **all languages including English** with the same structure:
- Description
- Category
- Syntax
- Tags
- Inputs
- Outputs
- Reference

For high-quality docs in every localization:
- Keep `description` in `backend/app/data/opcodes.json` concise and accurate.
- Keep port `id`/`name` stable and semantically correct.
- Keep `documentation_url` accurate so extractor data comes from the right manual page.
- Re-run `tools/update_opcode_localized_docs.py` whenever opcode ports, template, or docs URL change.

## 8) Tests To Update/Add

Primary test files:
- `backend/tests/test_api.py`
- `backend/tests/test_compiler_service.py`
- `backend/tests/test_opcode_service.py`

Recommended test coverage:
1. `GET /api/opcodes` includes your opcode.
2. Port schema is correct (type, required, defaults, accepted types).
3. `documentation_url` points to the right Csound page.
4. A compile-flow test confirms generated orchestra lines are correct.
5. Loader-level regressions are covered when changing the catalog structure.

Run at least:
- `uv run pytest backend/tests/test_api.py -k opcode`
- `uv run pytest backend/tests/test_compiler_service.py`
- `uv run pytest backend/tests/test_opcode_service.py`

## 9) Manual Verification Checklist

1. Start backend/frontend.
2. Open node catalog; confirm new opcode appears in expected category.
3. Add node; inspect ports and defaults.
4. Connect valid/invalid signal types; ensure type validation behaves correctly.
5. Compile patch and inspect generated ORC/CSD.
6. Open `?` documentation and confirm URL + content.
7. If realtime-related (MIDI/audio modulation), perform a runtime smoke test.

## 10) Common Pitfalls

- Wrong rate mapping (`k` vs `a`) causing connection errors.
- Missing `accepted_signal_types` for opcodes that legitimately accept multiple rates.
- Template argument order not matching Csound manual.
- Icon filename typo or missing SVG asset.
- Manual URL not set, resulting in generic fallback link.
- Forgetting tests for optional argument omission behavior.
- Editing `opcode_service.py` instead of the JSON catalog and wondering why the change is noisy or inconsistent.

## 11) Definition Of Done

A new opcode is complete when:
- Metadata is added and type-correct.
- Icon resolves in the catalog/node UI.
- Compile output is correct.
- `?` docs are meaningful and link to official Csound docs.
- Tests cover schema + compile behavior.
