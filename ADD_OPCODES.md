# Add New Csound Opcodes in VisualCSound

This guide is the implementation recipe for adding opcode support.

For the canonical opcode reference, always start from the official Csound manual:
- [Csound Part Reference](https://csound.com/docs/manual/PartReference.html)

The integrated opcode documentation in the app is generated from opcode metadata, so this file intentionally does **not** contain a long per-opcode catalog.

## What To Change (At a Glance)

1. Find opcode details in the Csound manual.
2. Map arguments/outputs to VisualCSound signal types (`i`, `k`, `a`, `S`, `f`).
3. Add the opcode spec in backend metadata (`OpcodeService`).
4. Add/update the manual URL mapping.
5. Choose or create an icon (`backend/app/static/icons/*.svg`).
6. Verify question-mark documentation output (EN + generated localized variants).
7. Add tests (API + compile behavior) and run them.

## 1) Look Up The Opcode Definition

Use the official manual page for the opcode (from Part Reference) and capture:
- Exact syntax line.
- Input arguments (name, order, optional/required).
- Output arguments.
- Allowed rates for each argument/output (`i-rate`, `k-rate`, `a-rate`, optionally `S`/`f`).
- Defaults or common defaults used by Csound examples.
- Constraints/ranges worth enforcing in metadata defaults.

Keep the original manual URL and wire it into `OPCODE_REFERENCE_URLS`.

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
- **Compatibility rules at compile time**: `backend/app/services/compiler_service.py` in `_is_compatible_type(...)`

Important behavior:
- A port with `signal_type=k` and `accepted_signal_types=[a, i]` can accept audio/control/init sources.
- Compiler currently also permits implicit `i -> k` when no explicit `accepted_signal_types` is set.

## 3) Add Opcode Metadata In Backend

Main file:
- `backend/app/services/opcode_service.py`

Steps:
1. Add or update the manual URL in `OPCODE_REFERENCE_URLS`.
2. In `_load_builtin_opcodes()`, add a new `self._spec(...)` block.
3. Define:
   - `name`, `category`, `description`, `tags`
   - `inputs`: `PortSpec(...)` list (`id`, `name`, `signal_type`, `required`, `default`, `accepted_signal_types`)
   - `outputs`: `PortSpec(...)` list
   - `template`: generated Csound line(s), using `{port_id}` placeholders
   - `icon`: `self._icon("your_icon.svg")`
4. Use stable, descriptive port IDs because these are used in graph connections and templates.

Template/literal notes:
- Optional args are represented with `required=False`; compiler can omit optional placeholders when missing.
- Defaults should be conservative and musically sane.
- Keep template order exactly aligned with Csound argument order.

## 4) Compiler And Type-Safety Checkpoints

Main file:
- `backend/app/services/compiler_service.py`

Usually no compiler changes are needed for a normal opcode addition, but verify:
- The new port types are compatible with existing `_is_compatible_type(...)` rules.
- Optional args in template render correctly.
- Default values format safely through `_format_literal(...)`.

If the opcode needs special behavior (custom rendering, multi-line expansion, special validation), implement it here and add tests.

## 5) Choose Or Create An Icon

Files:
- Icon assets: `backend/app/static/icons/`
- Icon wiring: `backend/app/services/opcode_service.py`

Workflow:
1. Reuse an existing family icon when appropriate (fast path).
2. If needed, add a new SVG in `backend/app/static/icons/<opcode>.svg`.
3. Keep icon style consistent with existing set (simple, high-contrast, readable at small sizes).
4. Reference it via `self._icon("<opcode>.svg")` in the opcode spec.

Tip: If a dedicated icon is not ready yet, map to a category icon first and ship functionality.

## 6) Question-Mark Documentation + Multilingual Behavior

The `?` button shows opcode documentation.

Data flow:
- Backend API returns `documentation_markdown` and `documentation_url` in opcode specs.
- Frontend renders this in `OpcodeDocumentationModal`.
- Localization behavior lives in `frontend/src/lib/documentation.ts`:
  - English: uses backend-provided markdown when available.
  - Other languages: generated from opcode metadata (`name`, `description`, ports, template, URL) with localized UI labels.

What you should write for good docs:
- A concise, accurate `description` in `OpcodeService`.
- Correct port names and defaults.
- Correct manual URL in `OPCODE_REFERENCE_URLS`.

If you need richer custom English markdown for specific opcodes, keep sections in markdown format:
- `### \`opcode_name\``

(Use sparingly; integrated generated docs are the default path.)

## 7) Tests To Update/Add

Primary test file:
- `backend/tests/test_api.py`

Recommended test coverage:
1. `GET /api/opcodes` includes your opcode.
2. Port schema is correct (type, required, defaults, accepted types).
3. `documentation_url` points to the right Csound page.
4. A compile-flow test confirms generated orchestra lines are correct.

Run at least:
- `uv run pytest backend/tests/test_api.py -k opcode`
- `uv run pytest backend/tests/test_compiler_service.py`

## 8) Manual Verification Checklist

1. Start backend/frontend.
2. Open node catalog; confirm new opcode appears in expected category.
3. Add node; inspect ports and defaults.
4. Connect valid/invalid signal types; ensure type validation behaves correctly.
5. Compile patch and inspect generated ORC/CSD.
6. Open `?` documentation and confirm URL + content.
7. If realtime-related (MIDI/audio modulation), perform a runtime smoke test.

## 9) Common Pitfalls

- Wrong rate mapping (`k` vs `a`) causing connection errors.
- Missing `accepted_signal_types` for opcodes that legitimately accept multiple rates.
- Template argument order not matching Csound manual.
- Icon filename typo or missing SVG asset.
- Manual URL not set, resulting in generic fallback link.
- Forgetting tests for optional argument omission behavior.

## 10) Definition Of Done

A new opcode is complete when:
- Metadata is added and type-correct.
- Icon resolves in the catalog/node UI.
- Compile output is correct.
- `?` docs are meaningful and link to official Csound docs.
- Tests cover schema + compile behavior.
