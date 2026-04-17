from __future__ import annotations

import re

from backend.app.models.patch import Connection
from backend.app.services.compiler_common import (
    FORMULA_TARGET_KEY_SEPARATOR,
    INPUT_FORMULAS_LAYOUT_KEY,
    CompilationError,
    FormulaToken,
)

FORMULA_UNARY_FUNCTIONS = frozenset({"abs", "ceil", "floor", "ampdb", "dbamp"})
FORMULA_LITERAL_IDENTIFIERS = frozenset({"sr"})


def resolve_input_expression(
    ui_layout: dict[str, object],
    to_node_id: str,
    to_port_id: str,
    inbound_connections: list[Connection],
    output_vars: dict[tuple[str, str], str],
) -> str:
    source_vars_by_binding: dict[tuple[str, str], str] = {}
    ordered_source_keys: list[tuple[str, str]] = []
    for connection in inbound_connections:
        source_key = (connection.from_node_id, connection.from_port_id)
        source_var = output_vars.get(source_key)
        if not source_var:
            raise CompilationError(
                [
                    "Internal compiler error: unresolved source variable "
                    f"for {connection.from_node_id}.{connection.from_port_id}"
                ]
            )
        if source_key not in source_vars_by_binding:
            ordered_source_keys.append(source_key)
        source_vars_by_binding[source_key] = source_var

    target_key = formula_target_key(to_node_id, to_port_id)
    context_label = f"{to_node_id}.{to_port_id}"
    formula_config = lookup_input_formula_config(ui_layout, target_key)
    if not formula_config:
        return default_multi_input_expression(
            [source_vars_by_binding[source_key] for source_key in ordered_source_keys]
        )

    token_to_expression: dict[str, str] = {}
    used_bindings: set[tuple[str, str]] = set()
    raw_bindings = formula_config.get("inputs")
    if isinstance(raw_bindings, list):
        for raw_binding in raw_bindings:
            if not isinstance(raw_binding, dict):
                continue

            token = raw_binding.get("token")
            from_node_id = raw_binding.get("from_node_id")
            from_port_id = raw_binding.get("from_port_id")
            if not isinstance(token, str) or not is_valid_formula_identifier(token):
                continue
            if not isinstance(from_node_id, str) or not from_node_id.strip():
                continue
            if not isinstance(from_port_id, str) or not from_port_id.strip():
                continue

            source_key = (from_node_id.strip(), from_port_id.strip())
            source_var = source_vars_by_binding.get(source_key)
            if not source_var or source_key in used_bindings or token in token_to_expression:
                continue

            used_bindings.add(source_key)
            token_to_expression[token] = source_var

    auto_index = 1
    for source_key in ordered_source_keys:
        if source_key in used_bindings:
            continue
        auto_token = next_auto_formula_token(token_to_expression, auto_index)
        auto_index += 1
        token_to_expression[auto_token] = source_vars_by_binding[source_key]

    raw_expression = formula_config.get("expression")
    if not isinstance(raw_expression, str) or raw_expression.strip() == "":
        if not token_to_expression:
            raise CompilationError([f"Invalid formula for input '{context_label}': formula is empty."])
        return default_multi_input_expression(list(token_to_expression.values()))

    return render_formula_expression(raw_expression, token_to_expression, context_label)


def lookup_input_formula_config(ui_layout: dict[str, object], target_key: str) -> dict[str, object] | None:
    raw_formulas = ui_layout.get(INPUT_FORMULAS_LAYOUT_KEY)
    if not isinstance(raw_formulas, dict):
        return None
    raw_config = raw_formulas.get(target_key)
    if not isinstance(raw_config, dict):
        return None
    return raw_config


def formula_target_key(to_node_id: str, to_port_id: str) -> str:
    return f"{to_node_id}{FORMULA_TARGET_KEY_SEPARATOR}{to_port_id}"


def is_valid_formula_identifier(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value))


def next_auto_formula_token(token_map: dict[str, str], start_index: int) -> str:
    index = max(1, start_index)
    while f"in{index}" in token_map:
        index += 1
    return f"in{index}"


def default_multi_input_expression(source_vars: list[str]) -> str:
    if not source_vars:
        raise CompilationError(["Internal compiler error: cannot build expression for empty source list."])
    if len(source_vars) == 1:
        return source_vars[0]
    return "(" + ") + (".join(source_vars) + ")"


def render_formula_expression(
    expression: str,
    token_to_expression: dict[str, str],
    context_label: str,
) -> str:
    if expression.strip() == "":
        raise CompilationError([f"Invalid formula for input '{context_label}': formula is empty."])

    tokens = tokenize_formula_expression(expression, context_label)
    if not tokens:
        raise CompilationError([f"Invalid formula for input '{context_label}': formula is empty."])

    index = 0

    def peek() -> FormulaToken | None:
        if index >= len(tokens):
            return None
        return tokens[index]

    def consume() -> FormulaToken:
        nonlocal index
        token = tokens[index]
        index += 1
        return token

    def parse_expression() -> str:
        left = parse_term()
        while True:
            token = peek()
            if token and token.kind == "operator" and token.value in {"+", "-"}:
                operator = consume().value
                right = parse_term()
                left = f"({left} {operator} {right})"
                continue
            return left

    def parse_term() -> str:
        left = parse_factor()
        while True:
            token = peek()
            if token and token.kind == "operator" and token.value in {"*", "/"}:
                operator = consume().value
                right = parse_factor()
                left = f"({left} {operator} {right})"
                continue
            return left

    def parse_factor() -> str:
        token = peek()
        if token is None:
            raise CompilationError([f"Invalid formula for input '{context_label}': unexpected end of expression."])

        if token.kind == "operator" and token.value in {"+", "-"}:
            operator = consume().value
            operand = parse_factor()
            return f"({operator}{operand})"

        if token.kind == "number":
            return consume().value

        if token.kind == "identifier":
            name = consume().value
            if peek() and peek().kind == "lparen":
                if name not in FORMULA_UNARY_FUNCTIONS:
                    raise CompilationError([f"Invalid formula for input '{context_label}': unknown function '{name}'."])
                consume()
                argument = parse_expression()
                if not peek() or peek().kind != "rparen":
                    raise CompilationError([f"Invalid formula for input '{context_label}': missing closing ')'."])
                consume()
                return f"{name}({argument})"
            value = token_to_expression.get(name)
            if value:
                return value
            if name in FORMULA_LITERAL_IDENTIFIERS:
                return name
            raise CompilationError([f"Invalid formula for input '{context_label}': unknown input token '{name}'."])

        if token.kind == "lparen":
            consume()
            inner = parse_expression()
            if not peek() or peek().kind != "rparen":
                raise CompilationError([f"Invalid formula for input '{context_label}': missing closing ')'."])
            consume()
            return f"({inner})"

        raise CompilationError([f"Invalid formula for input '{context_label}': unexpected token '{token.value}'."])

    rendered = parse_expression()
    if index < len(tokens):
        raise CompilationError(
            [
                "Invalid formula for input "
                f"'{context_label}': unexpected token '{tokens[index].value}' at position {tokens[index].position + 1}."
            ]
        )
    return rendered


def tokenize_formula_expression(expression: str, context_label: str) -> list[FormulaToken]:
    tokens: list[FormulaToken] = []
    index = 0
    while index < len(expression):
        char = expression[index]

        if char.isspace():
            index += 1
            continue

        if char in {"+", "-", "*", "/"}:
            tokens.append(FormulaToken(kind="operator", value=char, position=index))
            index += 1
            continue

        if char == "(":
            tokens.append(FormulaToken(kind="lparen", value=char, position=index))
            index += 1
            continue

        if char == ")":
            tokens.append(FormulaToken(kind="rparen", value=char, position=index))
            index += 1
            continue

        if char.isalpha() or char == "_":
            start = index
            index += 1
            while index < len(expression) and (expression[index].isalnum() or expression[index] == "_"):
                index += 1
            tokens.append(FormulaToken(kind="identifier", value=expression[start:index], position=start))
            continue

        if char.isdigit() or char == ".":
            start = index
            saw_digit = False
            saw_dot = False

            while index < len(expression):
                current = expression[index]
                if current.isdigit():
                    saw_digit = True
                    index += 1
                    continue
                if current == ".":
                    if saw_dot:
                        break
                    saw_dot = True
                    index += 1
                    continue
                break

            literal = expression[start:index]
            if not saw_digit or literal == ".":
                raise CompilationError([f"Invalid formula for input '{context_label}': invalid number near '{literal}'."])
            tokens.append(FormulaToken(kind="number", value=literal, position=start))
            continue

        raise CompilationError(
            [
                "Invalid formula for input "
                f"'{context_label}': unsupported character '{char}' at position {index + 1}."
            ]
        )

    return tokens
