# Patch Input Formula Reference

Use patch input formulas when a patch graph already has opcode connections and an input needs scaling or combination without inserting helper opcodes such as `a_mul` or `k_mul`.

The CLI writes the same metadata as the GUI:

```text
graph.ui_layout.input_formulas["TARGET_NODE::TARGET_PORT"]
```

Each formula has:

- `expression`: the formula text
- `inputs`: token bindings from formula tokens to existing source connections

Supported formula elements:

- input tokens: `in1`, `in2`, or explicit tokens such as `dry`, `wet`
- numbers: `0.1`, `.5`, `1`, `2.0`
- operators: `+`, `-`, `*`, `/`
- unary signs: `+in1`, `-in1`
- parentheses
- functions: `abs`, `ceil`, `floor`, `ampdb`, `dbamp`
- literal: `sr`

List supported operands:

```bash
uv run orchestron_cli --json patches formulas operands
```

List configured formulas on a patch:

```bash
uv run orchestron_cli --json patches formulas list "Lead Patch"
```

Scale a single existing input connection:

```bash
uv run orchestron_cli --json patches formulas set "Lead Patch" \
  --target filter.xcf \
  --expression "0.1 * in1"
```

When `--input` is omitted, current inbound connections to `--target` are bound as `in1`, `in2`, and so on in graph order. This works for single-input scaling and multi-input sums.

Use explicit bindings when token names or order matter:

```bash
uv run orchestron_cli --json patches formulas set "Lead Patch" \
  --target mixer.a \
  --input dry=osc.aout \
  --input wet=delay.aout \
  --expression "dry + (wet * 0.35)"
```

The source side of every `--input TOKEN=NODE.PORT` binding must already be connected to the target input. The formula command does not create graph connections.

Constant formulas are valid:

```bash
uv run orchestron_cli --json patches formulas set "Lead Patch" \
  --target osc.xamp \
  --expression "0.75"
```

Clear a formula:

```bash
uv run orchestron_cli --json patches formulas clear "Lead Patch" --target filter.xcf
```

Performance workflow:

1. Import or create the patch graph first.
2. Set or clear patch formulas with `patches formulas ...`.
3. Add the patch as an instrument in the performance edit session.
4. Run `edit validate`.
5. Run `edit commit`; the committed performance embeds the updated patch definition.

If a formula fails, inspect `error.message`, `error.path`, and `error.retry`. Common fixes are using an existing target input, binding unknown tokens with `--input`, or creating the missing graph connection in the GUI/bundle before retrying.
