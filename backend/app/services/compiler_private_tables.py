"""Proofs for private ftgenonce handles and explicitly seeded grain3 voices.

No CSD parsing: follow structured connections and the compiler's validated formulas.
"""
import ast
import math

from backend.app.models.opcode import SignalType
from backend.app.services.compiler_formula import resolve_input_expression

# Per producer, including a spare allocation at the fail-closed guard boundary.
TABLE_CACHE_ENTRIES = 512
AUTO_TABLE_BASE = 100  # Csound 6 FTAlloc automatic numbering starts at 101.
PRIVATE_TABLE_READERS = frozenset({'grain3', 'oscili', 'oscil', 'poscil', 'poscil3'})


def input_bounds(node, port, context, layout):
    """Conservative numeric bounds; unknown expressions remain unsupported."""
    bindings = {}
    variables = {}
    for index, compiled in enumerate(context.compiled_nodes.values()):
        source = compiled.node
        for output in compiled.spec.outputs:
            key = f'v{index}'
            variables[source.id, output.id] = key
            if source.opcode == 'const_i':
                value = source.params.get('value', 0)
                if isinstance(value, (int, float)):
                    bindings[key] = (value, value)
            elif source.opcode == 'perf_controller':
                bindings[key] = (source.params.get('min', 0), source.params.get('max', 1))
    links = context.inbound_index.get((node.id, port.id), [])
    try:
        if links or layout.get('input_formulas', {}).get(f'{node.id}::{port.id}'):
            expression = resolve_input_expression(layout, node.id, port.id, links, variables)
        else:
            expression = str(node.params.get(port.id, port.default))

        def bounds(expr):
            if isinstance(expr, ast.Constant) and type(expr.value) in (int, float):
                return expr.value, expr.value
            if isinstance(expr, ast.Name):
                return bindings[expr.id]
            if isinstance(expr, ast.UnaryOp) and isinstance(expr.op, (ast.USub, ast.UAdd)):
                a, b = bounds(expr.operand)
                return (-b, -a) if isinstance(expr.op, ast.USub) else (a, b)
            if isinstance(expr, ast.BinOp):
                a, b = bounds(expr.left)
                c, d = bounds(expr.right)
                if isinstance(expr.op, ast.Add):
                    return a+c, b+d
                if isinstance(expr.op, ast.Sub):
                    return a-d, b-c
                if isinstance(expr.op, ast.Mult):
                    values = (a*c, a*d, b*c, b*d)
                    return min(values), max(values)
                if isinstance(expr.op, ast.Div) and not c <= 0 <= d:
                    values = (a/c, a/d, b/c, b/d)
                    return min(values), max(values)
            if isinstance(expr, ast.Call) and isinstance(expr.func, ast.Name) and len(expr.args) == 1:
                a, b = bounds(expr.args[0])
                if expr.func.id in ('floor', 'ceil'):
                    fn = getattr(math, expr.func.id)
                    return fn(a), fn(b)
                if expr.func.id == 'abs':
                    return (0 if a <= 0 <= b else min(abs(a), abs(b))), max(abs(a), abs(b))
            raise ValueError('unknown numeric expression')

        result = bounds(ast.parse(expression, mode='eval').body)
        return result if all(math.isfinite(v) for v in result) and result[0] <= result[1] else None
    except (ValueError, TypeError, KeyError, SyntaxError, ArithmeticError):
        return None


def private_table_size(compiled, context, layout, audited):
    """Only auto-numbered, deterministic GEN10/20 tables with direct read-only handles."""
    node, spec = compiled.node, compiled.spec
    if node.opcode != 'ftgenonce' or not audited(spec):
        return None
    values = {p.id: input_bounds(node, p, context, layout) for p in spec.inputs[:4]}
    if values['ip1'] != (0, 0) or values['igen'] not in ((10, 10), (-10, -10), (20, 20), (-20, -20)):
        return None
    size = values['isize']
    if size is None or size[0] != size[1] or not 1 <= size[0] <= 1048576 or int(size[0]) != size[0]:
        return None
    # Positive Csound table sizes must be a power of two (or power + guard point).
    count = int(size[0])
    if count & (count - 1) and (count - 1) & (count - 2):
        return None
    for (target_id, port_id), links in context.inbound_index.items():
        if not any(c.from_node_id == node.id for c in links):
            continue
        target = context.compiled_nodes[target_id]
        port = next(p for p in target.spec.inputs if p.id == port_id)
        if (len(links) != 1 or links[0].from_port_id != 'ift'
                or target.spec.name not in PRIVATE_TABLE_READERS or not audited(target.spec)
                or port_id not in ('kfn', 'iwfn', 'ifn')
                or port.signal_type not in (SignalType.INIT, SignalType.CONTROL)):
            return None
        expression = resolve_input_expression(layout, target_id, port_id, links, {(node.id, 'ift'): 'handle'})
        parsed = ast.parse(expression, mode='eval').body
        if not isinstance(parsed, ast.Name) or parsed.id != 'handle':
            return None
    return count
