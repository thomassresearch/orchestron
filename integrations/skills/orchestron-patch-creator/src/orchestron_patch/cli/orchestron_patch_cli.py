#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import sys
from typing import Any
from urllib import error, parse, request

try:
    import yaml
except ImportError:  # pragma: no cover - exercised only in minimal environments
    yaml = None


DEFAULT_API_URL = os.environ.get("ORCHESTRON_API_URL", "http://localhost:8000/api")
DEFAULT_ENGINE_CONFIG = {
    "sr": 48000,
    "control_rate": 750,
    "ksmps": 64,
    "nchnls": 2,
    "software_buffer": 128,
    "hardware_buffer": 512,
    "0dbfs": 1.0,
}
SUPPORTED_FAMILIES = {"simple_osc", "subtractive", "fm_pad", "noise_texture"}
SOURCE_OPCODES = {"oscili", "vco2", "foscili", "noise", "pinker"}
INPUT_FORMULAS_LAYOUT_KEY = "input_formulas"
FORMULA_TARGET_KEY_SEPARATOR = "::"
FORMULA_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
FORMULA_UNARY_FUNCTIONS = frozenset({"abs", "ceil", "floor", "ampdb", "dbamp"})
FORMULA_LITERAL_IDENTIFIERS = frozenset({"sr"})
FORMULA_OPERATORS = ("+", "-", "*", "/")
MONO_EFFECT_OUTPUTS = {
    "butterlp": ("asig", "aout"),
    "butterhp": ("asig", "aout"),
    "moogladder": ("ain", "aout"),
    "moogladder2": ("ain", "aout"),
    "diode_ladder": ("ain", "aout"),
    "distort1": ("asig", "aout"),
    "flanger": ("asig", "aout"),
    "reverb2": ("asig", "aout"),
}
KNOWN_OPCODE_INPUTS = {
    "a_mul": {"a", "b"},
    "ampmidi": {"iscal"},
    "butterhp": {"asig", "xfreq", "iskip"},
    "butterlp": {"asig", "xfreq", "iskip"},
    "const_i": set(),
    "const_k": set(),
    "cpsmidi": set(),
    "diode_ladder": {"ain", "xcf", "xk", "inlp", "isaturation", "istor"},
    "distort1": {"asig", "kpregain", "kpostgain", "kshape1", "kshape2", "imode"},
    "flanger": {"asig", "adel", "kfeedback", "imaxd"},
    "foscili": {"xamp", "kcps", "xcar", "xmod", "kndx", "ifn", "iphs"},
    "k_mul": {"a", "b"},
    "k_to_a": {"kin"},
    "madsr": {"iatt", "idec", "islev", "irel", "idel", "ireltim", "idrss"},
    "mix2": {"a", "b"},
    "moogladder": {"ain", "kcf", "kres"},
    "moogladder2": {"ain", "xcf", "xres"},
    "noise": {"amp", "beta", "iseed", "iskip"},
    "oscili": {"amp", "freq", "ifn"},
    "outs": {"left", "right"},
    "pan2": {"asig", "xp", "imode"},
    "pinker": set(),
    "reverb2": {"asig", "krvt", "khf", "iskip"},
    "vco2": {"kamp", "kcps", "imode", "kpw", "kphs", "inyx"},
}
OPCODE_PARAM_ALIASES = {
    "oscili": {"table": "ifn"},
    "vco2": {
        "mode": "imode",
        "pulse_width": "kpw",
        "phase": "kphs",
        "sync_shape": "inyx",
    },
    "foscili": {
        "carrier_ratio": "xcar",
        "mod_ratio": "xmod",
        "mod_index": "kndx",
        "table": "ifn",
        "phase": "iphs",
    },
    "noise": {"color": "beta", "seed": "iseed", "skip_init": "iskip"},
    "butterlp": {"cutoff": "xfreq", "skip_init": "iskip"},
    "butterhp": {"cutoff": "xfreq", "skip_init": "iskip"},
    "moogladder": {"cutoff": "kcf", "resonance": "kres"},
    "moogladder2": {"cutoff": "xcf", "resonance": "xres"},
    "diode_ladder": {
        "cutoff": "xcf",
        "resonance": "xk",
        "nonlinear_position": "inlp",
        "saturation": "isaturation",
        "skip_init": "istor",
    },
    "distort1": {
        "pre_gain": "kpregain",
        "post_gain": "kpostgain",
        "shape1": "kshape1",
        "shape2": "kshape2",
        "mode": "imode",
    },
    "flanger": {"delay": "adel", "feedback": "kfeedback", "max_delay": "imaxd"},
    "reverb2": {"time": "krvt", "damping": "khf", "skip_init": "iskip"},
}
PASSTHROUGH_KEYS = {"params", "id", "opcode", "gain", "name", "description"}


@dataclass(frozen=True)
class GraphFormulaToken:
    kind: str
    value: str
    position: int


class PatchCliError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retry: list[str] | None = None,
        path: str | None = None,
        data: dict[str, Any] | None = None,
        backend: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retry = retry or []
        self.path = path
        self.data = data or {}
        self.backend = backend

    def to_json(self, *, debug: bool = False) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ok": False,
            "error": {
                "code": self.code,
                "message": self.message,
            },
        }
        if self.path:
            payload["error"]["path"] = self.path
        if self.retry:
            payload["error"]["retry"] = self.retry
        if self.data:
            payload["error"].update(self.data)
        if debug and self.backend is not None:
            payload["error"]["backend"] = self.backend
        return payload


@dataclass
class CliContext:
    api_url: str
    json_output: bool
    debug: bool
    timeout: float


class ApiClient:
    def __init__(self, api_url: str, *, timeout: float = 20.0) -> None:
        self.api_url = api_url.rstrip("/")
        self.timeout = timeout

    def get(self, path: str, query: dict[str, str] | None = None) -> Any:
        return self._request("GET", path, query=query)

    def post(self, path: str, payload: Any | None = None) -> Any:
        return self._request("POST", path, payload)

    def put(self, path: str, payload: Any | None = None) -> Any:
        return self._request("PUT", path, payload)

    def delete(self, path: str) -> Any:
        return self._request("DELETE", path)

    def _request(self, method: str, path: str, payload: Any | None = None, query: dict[str, str] | None = None) -> Any:
        data = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=True).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = request.Request(self._url(path, query=query), data=data, method=method, headers=headers)
        return self._open(req, operation=f"{method} {path}")

    def _url(self, path: str, query: dict[str, str] | None = None) -> str:
        normalized = path if path.startswith("/") else f"/{path}"
        url = f"{self.api_url}{normalized}"
        if query:
            url = f"{url}?{parse.urlencode(query)}"
        return url

    def _open(self, req: request.Request, *, operation: str) -> Any:
        try:
            with request.urlopen(req, timeout=self.timeout) as response:
                if response.status == 204:
                    return None
                body = response.read().decode("utf-8")
                return json.loads(body) if body else None
        except error.HTTPError as exc:
            backend = _read_backend_error(exc)
            message = _backend_message(backend) or f"Backend rejected {operation} with HTTP {exc.code}."
            raise PatchCliError(
                "backend_http_error",
                message,
                retry=["Inspect the backend diagnostics and adjust the patch spec.", "Run with --debug for raw backend detail."],
                backend=backend,
            ) from exc
        except error.URLError as exc:
            raise PatchCliError(
                "backend_unreachable",
                f"Cannot reach Orchestron backend at {self.api_url}: {exc.reason}",
                retry=["Start the backend, for example with `make run`.", "Pass --api-url if the backend uses a different URL."],
            ) from exc


class GraphBuilder:
    def __init__(self) -> None:
        self.nodes: list[dict[str, Any]] = []
        self.connections: list[dict[str, str]] = []
        self._counts: dict[str, int] = {}

    def add(self, opcode: str, *, node_id: str | None = None, params: dict[str, Any] | None = None, x: int = 0, y: int = 0) -> str:
        if not node_id:
            index = self._counts.get(opcode, 0) + 1
            self._counts[opcode] = index
            node_id = f"{_slug(opcode)}_{index}"
        self.nodes.append(
            {
                "id": node_id,
                "opcode": opcode,
                "params": _compact_params(params or {}),
                "position": {"x": x, "y": y},
            }
        )
        return node_id

    def connect(self, source_id: str, source_port: str, target_id: str, target_port: str) -> None:
        self.connections.append(
            {
                "from_node_id": source_id,
                "from_port_id": source_port,
                "to_node_id": target_id,
                "to_port_id": target_port,
            }
        )

    def graph(self, *, engine_config: dict[str, Any] | None = None) -> dict[str, Any]:
        return {
            "nodes": self.nodes,
            "connections": self.connections,
            "ui_layout": {},
            "engine_config": {**DEFAULT_ENGINE_CONFIG, **(engine_config or {})},
        }


def _read_backend_error(exc: error.HTTPError) -> Any:
    try:
        raw = exc.read().decode("utf-8")
    except Exception:
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def _backend_message(backend: Any) -> str | None:
    if isinstance(backend, dict):
        detail = backend.get("detail")
        if isinstance(detail, str):
            return detail
        if isinstance(detail, dict):
            diagnostics = detail.get("diagnostics")
            if isinstance(diagnostics, list):
                return "; ".join(str(item) for item in diagnostics)
            message = detail.get("message")
            if isinstance(message, str):
                return message
        if isinstance(detail, list):
            return "; ".join(str(item) for item in detail)
    if isinstance(backend, str):
        return backend
    return None


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "_", value.strip().lower()).strip("_")
    return normalized or "node"


def _as_bool(value: Any, *, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    if isinstance(value, int | float):
        return value != 0
    return default


def _number(value: Any, *, default: float) -> float:
    if isinstance(value, bool):
        return float(default)
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return float(default)
    return float(default)


def _compact_params(params: dict[str, Any]) -> dict[str, Any]:
    compact: dict[str, Any] = {}
    for key, value in params.items():
        if value is None:
            continue
        compact[key] = value
    return compact


def is_valid_formula_identifier(value: str) -> bool:
    return bool(FORMULA_IDENTIFIER_RE.fullmatch(value))


def formula_target_key(to_node_id: str, to_port_id: str) -> str:
    return f"{to_node_id}{FORMULA_TARGET_KEY_SEPARATOR}{to_port_id}"


def parse_port_ref(value: Any, *, field: str) -> tuple[str, str]:
    if not isinstance(value, str):
        raise PatchCliError("invalid_formula_ref", f"{field} must be a NODE.PORT string.", path=field)
    text = value.strip()
    if FORMULA_TARGET_KEY_SEPARATOR in text:
        node_id, port_id = text.split(FORMULA_TARGET_KEY_SEPARATOR, 1)
    elif "." in text:
        node_id, port_id = text.rsplit(".", 1)
    else:
        raise PatchCliError(
            "invalid_formula_ref",
            f"{field} must use NODE.PORT or NODE::PORT syntax.",
            path=field,
            retry=["Example: target: fm_a_foscili.xamp"],
        )
    node_id = node_id.strip()
    port_id = port_id.strip()
    if not node_id or not port_id:
        raise PatchCliError("invalid_formula_ref", f"{field} must include both node ID and port ID.", path=field)
    return node_id, port_id


def tokenize_formula_expression(expression: str, *, field: str) -> list[GraphFormulaToken]:
    tokens: list[GraphFormulaToken] = []
    index = 0
    while index < len(expression):
        char = expression[index]
        if char.isspace():
            index += 1
            continue
        if char in FORMULA_OPERATORS:
            tokens.append(GraphFormulaToken(kind="operator", value=char, position=index))
            index += 1
            continue
        if char == "(":
            tokens.append(GraphFormulaToken(kind="lparen", value=char, position=index))
            index += 1
            continue
        if char == ")":
            tokens.append(GraphFormulaToken(kind="rparen", value=char, position=index))
            index += 1
            continue
        if char.isalpha() or char == "_":
            start = index
            index += 1
            while index < len(expression) and (expression[index].isalnum() or expression[index] == "_"):
                index += 1
            tokens.append(GraphFormulaToken(kind="identifier", value=expression[start:index], position=start))
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
                raise PatchCliError(
                    "invalid_formula",
                    f"Invalid formula number near '{literal}'.",
                    path=field,
                    retry=["Use decimal numbers such as 0.1, .5, or 2."],
                )
            tokens.append(GraphFormulaToken(kind="number", value=literal, position=start))
            continue
        raise PatchCliError(
            "invalid_formula",
            f"Unsupported formula character '{char}' at position {index + 1}.",
            path=field,
            retry=["Use numbers, input tokens, sr, +, -, *, /, parentheses, or supported unary functions."],
        )
    return tokens


def validate_formula_expression(expression: str, allowed_identifiers: set[str], *, field: str) -> None:
    if not expression.strip():
        raise PatchCliError("invalid_formula", "Formula is empty.", path=field)
    tokens = tokenize_formula_expression(expression, field=field)
    if not tokens:
        raise PatchCliError("invalid_formula", "Formula is empty.", path=field)
    index = 0

    def current() -> GraphFormulaToken | None:
        return tokens[index] if index < len(tokens) else None

    def consume() -> GraphFormulaToken:
        nonlocal index
        token = tokens[index]
        index += 1
        return token

    def parse_expression() -> None:
        parse_term()
        while current() and current().kind == "operator" and current().value in {"+", "-"}:
            consume()
            parse_term()

    def parse_term() -> None:
        parse_factor()
        while current() and current().kind == "operator" and current().value in {"*", "/"}:
            consume()
            parse_factor()

    def parse_factor() -> None:
        token = current()
        if token is None:
            raise PatchCliError("invalid_formula", "Unexpected end of formula.", path=field)
        if token.kind == "operator" and token.value in {"+", "-"}:
            consume()
            parse_factor()
            return
        if token.kind == "number":
            consume()
            return
        if token.kind == "identifier":
            name = consume().value
            if current() and current().kind == "lparen":
                if name not in FORMULA_UNARY_FUNCTIONS:
                    raise PatchCliError(
                        "invalid_formula",
                        f"Unknown formula function '{name}'.",
                        path=field,
                        retry=[f"Supported functions: {', '.join(sorted(FORMULA_UNARY_FUNCTIONS))}."],
                    )
                consume()
                parse_expression()
                if not current() or current().kind != "rparen":
                    raise PatchCliError("invalid_formula", f"Missing closing ')' for '{name}(...)'.", path=field)
                consume()
                return
            if name not in allowed_identifiers and name not in FORMULA_LITERAL_IDENTIFIERS:
                raise PatchCliError(
                    "invalid_formula",
                    f"Unknown formula input token '{name}'.",
                    path=field,
                    retry=["Bind the token in formulas[].inputs or use an auto-bound token like in1."],
                )
            return
        if token.kind == "lparen":
            consume()
            parse_expression()
            if not current() or current().kind != "rparen":
                raise PatchCliError("invalid_formula", "Missing closing ')'.", path=field)
            consume()
            return
        raise PatchCliError("invalid_formula", f"Unexpected formula token '{token.value}'.", path=field)

    parse_expression()
    if index < len(tokens):
        token = tokens[index]
        raise PatchCliError(
            "invalid_formula",
            f"Unexpected formula token '{token.value}' at position {token.position + 1}.",
            path=field,
        )


def normalize_formula_specs(raw_formulas: Any) -> list[dict[str, Any]]:
    if raw_formulas is None:
        return []
    normalized: list[dict[str, Any]] = []
    if isinstance(raw_formulas, dict):
        for target, raw_config in raw_formulas.items():
            if isinstance(raw_config, str):
                normalized.append({"target": str(target), "expression": raw_config, "inputs": []})
            elif isinstance(raw_config, dict):
                normalized.append({"target": str(target), **raw_config})
            else:
                raise PatchCliError("invalid_formulas", "Formula map values must be strings or mappings.", path=f"formulas.{target}")
        return normalized
    if isinstance(raw_formulas, list):
        for index, entry in enumerate(raw_formulas):
            if not isinstance(entry, dict):
                raise PatchCliError("invalid_formulas", "Each formula entry must be a mapping/object.", path=f"formulas[{index}]")
            normalized.append(entry)
        return normalized
    raise PatchCliError("invalid_formulas", "formulas must be a list or mapping when provided.", path="formulas")


def normalize_formula_input(raw_input: Any, *, field: str) -> dict[str, str]:
    if isinstance(raw_input, str):
        if "=" not in raw_input:
            raise PatchCliError(
                "invalid_formula_input",
                f"{field} must use TOKEN=NODE.PORT syntax.",
                path=field,
                retry=["Example: in1=fm_a_foscili.asig"],
            )
        token, source = raw_input.split("=", 1)
        from_node_id, from_port_id = parse_port_ref(source, field=f"{field}.source")
    elif isinstance(raw_input, dict):
        token = raw_input.get("token")
        if not isinstance(token, str):
            raise PatchCliError("invalid_formula_input", f"{field}.token must be a string.", path=f"{field}.token")
        if "source" in raw_input:
            from_node_id, from_port_id = parse_port_ref(raw_input["source"], field=f"{field}.source")
        else:
            from_node_id = raw_input.get("from_node_id")
            from_port_id = raw_input.get("from_port_id")
            if not isinstance(from_node_id, str) or not isinstance(from_port_id, str):
                raise PatchCliError(
                    "invalid_formula_input",
                    f"{field} must include source or from_node_id/from_port_id.",
                    path=field,
                )
            from_node_id = from_node_id.strip()
            from_port_id = from_port_id.strip()
    else:
        raise PatchCliError("invalid_formula_input", f"{field} must be a string or mapping.", path=field)

    token = token.strip()
    if not is_valid_formula_identifier(token):
        raise PatchCliError(
            "invalid_formula_input",
            f"{field}.token '{token}' is not a valid formula identifier.",
            path=f"{field}.token",
            retry=["Use identifiers such as in1, in2, dry, wet, or mod_a."],
        )
    if not from_node_id or not from_port_id:
        raise PatchCliError("invalid_formula_input", f"{field} source must include node and port IDs.", path=field)
    return {"token": token, "from_node_id": from_node_id, "from_port_id": from_port_id}


def inbound_connections_for_target(graph: dict[str, Any], target_node_id: str, target_port_id: str) -> list[dict[str, str]]:
    return [
        connection
        for connection in graph.get("connections", [])
        if isinstance(connection, dict)
        and connection.get("to_node_id") == target_node_id
        and connection.get("to_port_id") == target_port_id
        and isinstance(connection.get("from_node_id"), str)
        and isinstance(connection.get("from_port_id"), str)
    ]


def auto_formula_bindings(inbound_connections: list[dict[str, str]]) -> list[dict[str, str]]:
    bindings: list[dict[str, str]] = []
    seen_sources: set[tuple[str, str]] = set()
    for connection in inbound_connections:
        source = (connection["from_node_id"], connection["from_port_id"])
        if source in seen_sources:
            continue
        seen_sources.add(source)
        bindings.append({"token": f"in{len(bindings) + 1}", "from_node_id": source[0], "from_port_id": source[1]})
    return bindings


def normalize_formula_bindings(
    graph: dict[str, Any],
    raw_inputs: Any,
    *,
    target_node_id: str,
    target_port_id: str,
    field: str,
) -> list[dict[str, str]]:
    inbound = inbound_connections_for_target(graph, target_node_id, target_port_id)
    inbound_sources = {(connection["from_node_id"], connection["from_port_id"]) for connection in inbound}
    if raw_inputs is None:
        return auto_formula_bindings(inbound)
    if not isinstance(raw_inputs, list):
        raise PatchCliError("invalid_formula_input", f"{field} must be a list when provided.", path=field)
    bindings: list[dict[str, str]] = []
    seen_tokens: set[str] = set()
    seen_sources: set[tuple[str, str]] = set()
    for index, raw_input in enumerate(raw_inputs):
        binding = normalize_formula_input(raw_input, field=f"{field}[{index}]")
        source = (binding["from_node_id"], binding["from_port_id"])
        if binding["token"] in seen_tokens:
            raise PatchCliError("duplicate_formula_token", f"Formula token '{binding['token']}' is used more than once.", path=f"{field}[{index}]")
        if source in seen_sources:
            raise PatchCliError("duplicate_formula_source", f"Formula source '{source[0]}.{source[1]}' is used more than once.", path=f"{field}[{index}]")
        if source not in inbound_sources:
            raise PatchCliError(
                "formula_source_not_connected",
                f"Formula source '{source[0]}.{source[1]}' is not connected to target '{target_node_id}.{target_port_id}'.",
                path=f"{field}[{index}]",
                retry=["Use a source that is already connected to the target input, or add that connection to the generated graph first."],
            )
        seen_tokens.add(binding["token"])
        seen_sources.add(source)
        bindings.append(binding)
    return bindings


def apply_input_formulas(graph: dict[str, Any], raw_formulas: Any) -> dict[str, Any]:
    formulas = normalize_formula_specs(raw_formulas)
    if not formulas:
        return graph
    next_graph = {
        **graph,
        "ui_layout": dict(graph.get("ui_layout") if isinstance(graph.get("ui_layout"), dict) else {}),
    }
    nodes_by_id = {
        str(node.get("id")): node
        for node in next_graph.get("nodes", [])
        if isinstance(node, dict) and isinstance(node.get("id"), str)
    }
    formula_map: dict[str, dict[str, Any]] = {}
    for index, formula in enumerate(formulas):
        field = f"formulas[{index}]"
        target_node_id, target_port_id = parse_port_ref(formula.get("target"), field=f"{field}.target")
        target_node = nodes_by_id.get(target_node_id)
        if not target_node:
            raise PatchCliError(
                "formula_target_not_found",
                f"Formula target node '{target_node_id}' does not exist in the generated graph.",
                path=f"{field}.target",
                retry=["Render the graph and use one of graph.nodes[].id."],
            )
        opcode = str(target_node.get("opcode", ""))
        known_inputs = KNOWN_OPCODE_INPUTS.get(opcode)
        if known_inputs is not None and target_port_id not in known_inputs:
            raise PatchCliError(
                "formula_target_input_not_found",
                f"Formula target '{target_node_id}.{target_port_id}' is not an input on opcode '{opcode}'.",
                path=f"{field}.target",
                retry=[f"Use one of: {', '.join(sorted(known_inputs))}." if known_inputs else "Choose a node with input ports."],
            )
        expression = formula.get("expression")
        if not isinstance(expression, str):
            raise PatchCliError("invalid_formula", f"{field}.expression must be a string.", path=f"{field}.expression")
        bindings = normalize_formula_bindings(
            next_graph,
            formula.get("inputs"),
            target_node_id=target_node_id,
            target_port_id=target_port_id,
            field=f"{field}.inputs",
        )
        validate_formula_expression(expression, {binding["token"] for binding in bindings}, field=f"{field}.expression")
        formula_map[formula_target_key(target_node_id, target_port_id)] = {
            "expression": expression.strip(),
            "inputs": bindings,
        }
    next_graph["ui_layout"][INPUT_FORMULAS_LAYOUT_KEY] = formula_map
    return next_graph


def load_spec(path: Path) -> dict[str, Any]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise PatchCliError("spec_read_failed", f"Cannot read spec file '{path}': {exc}") from exc
    try:
        if path.suffix.lower() == ".json":
            loaded = json.loads(text)
        else:
            if yaml is None:
                raise PatchCliError(
                    "yaml_unavailable",
                    "PyYAML is not installed; use a .json spec or install the skill project dependencies.",
                    retry=["Run with `uv run --project integrations/skills/orchestron-patch-creator ...`."],
                )
            loaded = yaml.safe_load(text)
    except PatchCliError:
        raise
    except Exception as exc:
        raise PatchCliError("spec_parse_failed", f"Cannot parse spec file '{path}': {exc}") from exc
    if not isinstance(loaded, dict):
        raise PatchCliError("invalid_spec", "Patch spec must be a mapping/object at the top level.")
    return loaded


def default_layers_for_family(family: str) -> list[dict[str, Any]]:
    if family == "fm_pad":
        return [
            {"id": "fm_a", "opcode": "foscili", "gain": 0.55, "carrier_ratio": 1, "mod_ratio": 2, "mod_index": 1.6, "table": 1},
            {"id": "fm_b", "opcode": "foscili", "gain": 0.35, "carrier_ratio": 1, "mod_ratio": 3.01, "mod_index": 0.8, "table": 1},
        ]
    if family == "noise_texture":
        return [{"id": "noise", "opcode": "noise", "gain": 0.35, "color": 0.2}]
    if family == "subtractive":
        return [{"id": "osc", "opcode": "vco2", "gain": 0.45, "mode": 0, "pulse_width": 0.5}]
    return [{"id": "osc", "opcode": "oscili", "gain": 0.45, "table": 1}]


def validate_spec(spec: dict[str, Any]) -> dict[str, Any]:
    family = str(spec.get("family", "simple_osc")).strip() or "simple_osc"
    if family not in SUPPORTED_FAMILIES:
        raise PatchCliError(
            "unsupported_family",
            f"Unsupported patch family '{family}'.",
            retry=[f"Use one of: {', '.join(sorted(SUPPORTED_FAMILIES))}."],
            path="family",
        )
    layers = spec.get("layers")
    if layers is None:
        layers = default_layers_for_family(family)
    if not isinstance(layers, list) or not layers:
        raise PatchCliError("invalid_layers", "Patch spec requires a non-empty layers list.", path="layers")
    for index, layer in enumerate(layers):
        if not isinstance(layer, dict):
            raise PatchCliError("invalid_layer", "Each layer must be a mapping/object.", path=f"layers[{index}]")
        opcode = str(layer.get("opcode", "")).strip()
        if opcode not in SOURCE_OPCODES:
            raise PatchCliError(
                "unsupported_source_opcode",
                f"Layer {index + 1} uses unsupported source opcode '{opcode}'.",
                retry=[f"Use one of: {', '.join(sorted(SOURCE_OPCODES))}."],
                path=f"layers[{index}].opcode",
            )
    effects = spec.get("effects", [])
    if effects is None:
        effects = []
    if not isinstance(effects, list):
        raise PatchCliError("invalid_effects", "effects must be a list when provided.", path="effects")
    for index, effect in enumerate(effects):
        if not isinstance(effect, dict):
            raise PatchCliError("invalid_effect", "Each effect must be a mapping/object.", path=f"effects[{index}]")
        opcode = str(effect.get("opcode", "")).strip()
        if opcode not in MONO_EFFECT_OUTPUTS:
            raise PatchCliError(
                "unsupported_effect_opcode",
                f"Effect {index + 1} uses unsupported effect opcode '{opcode}'.",
                retry=[f"Use one of: {', '.join(sorted(MONO_EFFECT_OUTPUTS))}."],
                path=f"effects[{index}].opcode",
            )
    return {**spec, "family": family, "layers": layers, "effects": effects}


def build_patch_payload(
    spec: dict[str, Any],
    *,
    name: str | None = None,
    description: str | None = None,
    is_template: bool | None = None,
) -> dict[str, Any]:
    spec = validate_spec(spec)
    builder = GraphBuilder()
    y = 60

    cps = builder.add("cpsmidi", node_id="pitch_cpsmidi", x=40, y=40)
    amp_scale = add_const_i(builder, "velocity_scale_const", 1.0, x=40, y=130)
    amp = builder.add("ampmidi", node_id="velocity_ampmidi", x=250, y=150)
    builder.connect(amp_scale, "iout", amp, "iscal")

    envelope = dict(spec.get("envelope") or {})
    env_attack = add_const_i(builder, "env_attack_const", _number(envelope.get("attack", 0.01), default=0.01), x=40, y=260)
    env_decay = add_const_i(builder, "env_decay_const", _number(envelope.get("decay", 0.2), default=0.2), x=40, y=320)
    env_sustain = add_const_i(builder, "env_sustain_const", _number(envelope.get("sustain", 0.7), default=0.7), x=40, y=380)
    env_release = add_const_i(builder, "env_release_const", _number(envelope.get("release", 0.25), default=0.25), x=40, y=440)
    env = builder.add("madsr", node_id="amp_madsr", x=250, y=340)
    builder.connect(env_attack, "iout", env, "iatt")
    builder.connect(env_decay, "iout", env, "idec")
    builder.connect(env_sustain, "iout", env, "islev")
    builder.connect(env_release, "iout", env, "irel")
    if envelope.get("delay") is not None:
        env_delay = add_const_i(builder, "env_delay_const", _number(envelope.get("delay"), default=0), x=40, y=500)
        builder.connect(env_delay, "iout", env, "idel")
    if envelope.get("release_time") is not None:
        env_release_time = add_const_i(
            builder,
            "env_release_time_const",
            _number(envelope.get("release_time"), default=-1),
            x=40,
            y=560,
        )
        builder.connect(env_release_time, "iout", env, "ireltim")

    amp_env = builder.add("k_mul", node_id="amp_velocity_envelope", x=460, y=240)
    builder.connect(amp, "iamp", amp_env, "a")
    builder.connect(env, "kenv", amp_env, "b")

    layer_outputs: list[tuple[str, str]] = []
    for index, layer in enumerate(spec["layers"]):
        layer_id = _slug(str(layer.get("id") or layer.get("opcode") or f"layer_{index + 1}"))
        layer_gain = _number(layer.get("gain", 1), default=1)
        layer_amp = amp_env
        if layer_gain != 1:
            gain = builder.add("const_k", node_id=f"{layer_id}_gain", params={"value": layer_gain}, x=250, y=y + 90)
            scaled = builder.add("k_mul", node_id=f"{layer_id}_amp", x=430, y=y + 60)
            builder.connect(amp_env, "kout", scaled, "a")
            builder.connect(gain, "kout", scaled, "b")
            layer_amp = scaled

        opcode = str(layer["opcode"])
        source = builder.add(opcode, node_id=f"{layer_id}_{opcode}", params=source_params(layer), x=620, y=y)
        output_override = connect_source_inputs(builder, opcode=opcode, source_id=source, amp_id=layer_amp, cps_id=cps)
        layer_outputs.append(output_override or (source, source_output_port(opcode)))
        y += 150

    signal_node, signal_port = mix_layers(builder, layer_outputs, start_x=820, start_y=90)
    for index, effect in enumerate(spec["effects"]):
        opcode = str(effect["opcode"])
        input_port, output_port = MONO_EFFECT_OUTPUTS[opcode]
        effect_id = builder.add(opcode, node_id=f"effect_{index + 1}_{opcode}", params=effect_params(effect), x=1040 + index * 190, y=130)
        builder.connect(signal_node, signal_port, effect_id, input_port)
        signal_node, signal_port = effect_id, output_port

    output = dict(spec.get("output") or {})
    pan = builder.add("pan2", node_id="output_pan2", params={"xp": _number(output.get("pan", 0.5), default=0.5), "imode": output.get("mode", 0)}, x=1300, y=130)
    outs = builder.add("outs", node_id="output_outs", x=1500, y=130)
    builder.connect(signal_node, signal_port, pan, "asig")
    builder.connect(pan, "aleft", outs, "left")
    builder.connect(pan, "aright", outs, "right")

    graph = builder.graph(engine_config=spec.get("engine") if isinstance(spec.get("engine"), dict) else None)
    graph = apply_input_formulas(graph, spec.get("formulas"))

    payload = {
        "name": name or str(spec.get("name") or "Agent Patch"),
        "description": description if description is not None else str(spec.get("description") or ""),
        "is_template": _as_bool(is_template, default=_as_bool(spec.get("is_template"), default=False)) if is_template is not None else _as_bool(spec.get("is_template"), default=False),
        "schema_version": int(spec.get("schema_version", 1)),
        "graph": graph,
    }
    validate_graph_invariants(payload["graph"])
    return payload


def source_params(layer: dict[str, Any]) -> dict[str, Any]:
    opcode = str(layer["opcode"])
    params = dict(layer.get("params") or {})
    aliases = OPCODE_PARAM_ALIASES.get(opcode, {})
    for key, value in layer.items():
        if key in PASSTHROUGH_KEYS:
            continue
        params[aliases.get(key, key)] = value
    if opcode == "foscili":
        params.setdefault("xcar", 1)
        params.setdefault("xmod", 2)
        params.setdefault("kndx", 1)
        params.setdefault("ifn", 1)
    if opcode == "oscili":
        params.setdefault("ifn", 1)
    return params


def effect_params(effect: dict[str, Any]) -> dict[str, Any]:
    opcode = str(effect["opcode"])
    params = dict(effect.get("params") or {})
    aliases = OPCODE_PARAM_ALIASES.get(opcode, {})
    for key, value in effect.items():
        if key in PASSTHROUGH_KEYS:
            continue
        params[aliases.get(key, key)] = value
    return params


def add_const_i(builder: GraphBuilder, node_id: str, value: float, *, x: int, y: int) -> str:
    return builder.add("const_i", node_id=node_id, params={"value": value}, x=x, y=y)


def connect_source_inputs(builder: GraphBuilder, *, opcode: str, source_id: str, amp_id: str, cps_id: str) -> tuple[str, str] | None:
    if opcode == "foscili":
        builder.connect(amp_id, "kout", source_id, "xamp")
        builder.connect(cps_id, "kfreq", source_id, "kcps")
        return None
    if opcode == "oscili":
        builder.connect(amp_id, "kout", source_id, "amp")
        builder.connect(cps_id, "kfreq", source_id, "freq")
        return None
    if opcode == "vco2":
        builder.connect(amp_id, "kout", source_id, "kamp")
        builder.connect(cps_id, "kfreq", source_id, "kcps")
        return None
    if opcode == "noise":
        builder.connect(amp_id, "kout", source_id, "amp")
        return None
    if opcode == "pinker":
        amp_audio = builder.add("k_to_a", node_id=f"{source_id}_amp_audio", x=760, y=300)
        scaled = builder.add("a_mul", node_id=f"{source_id}_scaled", x=820, y=300)
        builder.connect(amp_id, "kout", amp_audio, "kin")
        builder.connect(source_id, "aout", scaled, "a")
        builder.connect(amp_audio, "aout", scaled, "b")
        return (scaled, "aout")
    return None


def source_output_port(opcode: str) -> str:
    if opcode == "pinker":
        return "aout"
    if opcode == "noise":
        return "aout"
    return "asig"


def mix_layers(builder: GraphBuilder, outputs: list[tuple[str, str]], *, start_x: int, start_y: int) -> tuple[str, str]:
    if not outputs:
        raise PatchCliError("empty_signal_path", "No source layers were generated.")
    current_node, current_port = outputs[0]
    for index, (node_id, port_id) in enumerate(outputs[1:], start=1):
        mixer = builder.add("mix2", node_id=f"layer_mix_{index}", x=start_x + index * 150, y=start_y + index * 40)
        builder.connect(current_node, current_port, mixer, "a")
        builder.connect(node_id, port_id, mixer, "b")
        current_node, current_port = mixer, "aout"
    return current_node, current_port


def validate_graph_invariants(graph: dict[str, Any]) -> None:
    nodes = graph.get("nodes")
    connections = graph.get("connections")
    if not isinstance(nodes, list) or not nodes:
        raise PatchCliError("invalid_graph", "Generated graph has no nodes.")
    if not isinstance(connections, list):
        raise PatchCliError("invalid_graph", "Generated graph connections are missing.")
    if nodes[-1].get("opcode") != "outs":
        raise PatchCliError("invalid_graph", "The last node in the generated graph must be outs.")
    outs_nodes = [node for node in nodes if node.get("opcode") == "outs"]
    if len(outs_nodes) != 1:
        raise PatchCliError("invalid_graph", "Generated graph must contain exactly one outs node.")
    outs_id = outs_nodes[0]["id"]
    target_ports = {item["to_port_id"] for item in connections if item["to_node_id"] == outs_id}
    if target_ports != {"left", "right"}:
        raise PatchCliError("invalid_graph", "outs node must have left and right inputs connected.")
    required_opcodes = {"cpsmidi", "ampmidi", "madsr"}
    present = {str(node.get("opcode")) for node in nodes}
    missing = sorted(required_opcodes - present)
    if missing:
        raise PatchCliError("invalid_graph", f"Generated graph is missing required opcodes: {', '.join(missing)}.")
    require_const_i_connection(
        nodes,
        connections,
        target_node_id="velocity_ampmidi",
        target_port_id="iscal",
        expected_value=1.0,
        label="ampmidi Scale",
    )
    for target_port_id, label in (
        ("iatt", "madsr Attack"),
        ("idec", "madsr Decay"),
        ("islev", "madsr Sustain"),
        ("irel", "madsr Release"),
    ):
        require_const_i_connection(
            nodes,
            connections,
            target_node_id="amp_madsr",
            target_port_id=target_port_id,
            expected_value=None,
            label=label,
        )
    downstream_from_outs = [item for item in connections if item["from_node_id"] == outs_id]
    if downstream_from_outs:
        raise PatchCliError("invalid_graph", "outs node must not feed downstream nodes.")


def require_const_i_connection(
    nodes: list[dict[str, Any]],
    connections: list[dict[str, str]],
    *,
    target_node_id: str,
    target_port_id: str,
    expected_value: float | None,
    label: str,
) -> None:
    nodes_by_id = {str(node.get("id")): node for node in nodes}
    inbound = [
        connection
        for connection in connections
        if connection.get("to_node_id") == target_node_id and connection.get("to_port_id") == target_port_id
    ]
    if len(inbound) != 1:
        raise PatchCliError("invalid_graph", f"{label} must have exactly one const_i source connection.")
    source = nodes_by_id.get(inbound[0].get("from_node_id", ""))
    if not source or source.get("opcode") != "const_i" or inbound[0].get("from_port_id") != "iout":
        raise PatchCliError("invalid_graph", f"{label} must be connected from const_i.iout.")
    if expected_value is not None:
        actual = _number((source.get("params") or {}).get("value"), default=float("nan"))
        if actual != expected_value:
            raise PatchCliError("invalid_graph", f"{label} const_i value must be {expected_value}.")


def patch_name_from_spec(spec: dict[str, Any], override: str | None = None) -> str:
    if override:
        return override
    name = str(spec.get("name") or "").strip()
    return name or "Agent Patch"


def print_payload(payload: Any, ctx: CliContext) -> None:
    if ctx.json_output:
        print(json.dumps({"ok": True, "data": payload}, indent=2, sort_keys=True))
        return
    if isinstance(payload, str):
        print(payload)
    else:
        print(json.dumps(payload, indent=2, sort_keys=True))


def output_error(error_value: PatchCliError, ctx: CliContext) -> None:
    if ctx.json_output:
        print(json.dumps(error_value.to_json(debug=ctx.debug), indent=2, sort_keys=True), file=sys.stderr)
        return
    print(f"error: {error_value.message}", file=sys.stderr)
    for hint in error_value.retry:
        print(f"retry: {hint}", file=sys.stderr)
    if ctx.debug and error_value.backend is not None:
        print(json.dumps(error_value.backend, indent=2, sort_keys=True), file=sys.stderr)


def command_health(args: argparse.Namespace, ctx: CliContext) -> None:
    print_payload(ApiClient(ctx.api_url, timeout=ctx.timeout).get("/health"), ctx)


def command_opcodes_list(args: argparse.Namespace, ctx: CliContext) -> None:
    query = {"category": args.category} if args.category else None
    print_payload(ApiClient(ctx.api_url, timeout=ctx.timeout).get("/opcodes", query=query), ctx)


def command_opcodes_get(args: argparse.Namespace, ctx: CliContext) -> None:
    print_payload(ApiClient(ctx.api_url, timeout=ctx.timeout).get(f"/opcodes/{parse.quote(args.name)}"), ctx)


def command_templates_list(args: argparse.Namespace, ctx: CliContext) -> None:
    print_payload(
        {
            "families": sorted(SUPPORTED_FAMILIES),
            "source_opcodes": sorted(SOURCE_OPCODES),
            "effect_opcodes": sorted(MONO_EFFECT_OUTPUTS),
        },
        ctx,
    )


def command_spec_validate(args: argparse.Namespace, ctx: CliContext) -> None:
    spec = load_spec(Path(args.spec))
    normalized = validate_spec(spec)
    payload = build_patch_payload(normalized, name=args.name, description=args.description, is_template=args.template)
    print_payload(
        {
            "name": payload["name"],
            "family": normalized["family"],
            "node_count": len(payload["graph"]["nodes"]),
            "connection_count": len(payload["graph"]["connections"]),
            "formula_count": len((payload["graph"].get("ui_layout", {}).get(INPUT_FORMULAS_LAYOUT_KEY, {}) or {})),
            "last_opcode": payload["graph"]["nodes"][-1]["opcode"],
        },
        ctx,
    )


def command_graph_render(args: argparse.Namespace, ctx: CliContext) -> None:
    spec = load_spec(Path(args.spec))
    payload = build_patch_payload(spec, name=args.name, description=args.description, is_template=args.template)
    graph = payload["graph"]
    if args.out:
        Path(args.out).write_text(json.dumps(graph, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print_payload({"path": args.out, "node_count": len(graph["nodes"]), "connection_count": len(graph["connections"])}, ctx)
        return
    print_payload(graph, ctx)


def command_patch_list(args: argparse.Namespace, ctx: CliContext) -> None:
    print_payload(ApiClient(ctx.api_url, timeout=ctx.timeout).get("/patches"), ctx)


def command_patch_get(args: argparse.Namespace, ctx: CliContext) -> None:
    print_payload(ApiClient(ctx.api_url, timeout=ctx.timeout).get(f"/patches/{parse.quote(args.patch_id)}"), ctx)


def command_patch_create(args: argparse.Namespace, ctx: CliContext) -> None:
    spec = load_spec(Path(args.spec))
    payload = build_patch_payload(
        spec,
        name=patch_name_from_spec(spec, args.name),
        description=args.description,
        is_template=args.template,
    )
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    compile_result = None
    if args.compile:
        compile_result = compile_payload_preflight(client, payload)
    created = client.post("/patches", payload)
    print_payload({"patch": created, "compile": compile_result}, ctx)


def command_patch_update(args: argparse.Namespace, ctx: CliContext) -> None:
    spec = load_spec(Path(args.spec))
    payload = build_patch_payload(spec, name=args.name, description=args.description, is_template=args.template)
    update_payload = {
        "graph": payload["graph"],
        "schema_version": payload["schema_version"],
    }
    if args.name is not None or spec.get("name") is not None:
        update_payload["name"] = payload["name"]
    if args.description is not None or spec.get("description") is not None:
        update_payload["description"] = payload["description"]
    if args.template is not None or spec.get("is_template") is not None:
        update_payload["is_template"] = payload["is_template"]
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    compile_result = None
    if args.compile:
        compile_result = compile_payload_preflight(client, payload)
    updated = client.put(f"/patches/{parse.quote(args.patch_id)}", update_payload)
    print_payload({"patch": updated, "compile": compile_result}, ctx)


def command_patch_compile(args: argparse.Namespace, ctx: CliContext) -> None:
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    print_payload(compile_existing_patch(client, args.patch_id), ctx)


def compile_payload_preflight(client: ApiClient, payload: dict[str, Any]) -> dict[str, Any]:
    temp_payload = {**payload, "name": f"__patch_cli_preflight__ {payload['name']}", "is_template": False}
    patch_id: str | None = None
    try:
        created = client.post("/patches", temp_payload)
        patch_id = str(created["id"])
        return compile_existing_patch(client, patch_id)
    finally:
        if patch_id:
            try:
                client.delete(f"/patches/{parse.quote(patch_id)}")
            except PatchCliError:
                pass


def compile_existing_patch(client: ApiClient, patch_id: str) -> dict[str, Any]:
    session_id: str | None = None
    try:
        session = client.post("/sessions", {"patch_id": patch_id})
        session_id = str(session["session_id"])
        result = client.post(f"/sessions/{parse.quote(session_id)}/compile")
        return {
            "session_id": session_id,
            "state": result.get("state"),
            "diagnostics": result.get("diagnostics", []),
            "orc": result.get("orc", ""),
        }
    finally:
        if session_id:
            try:
                client.delete(f"/sessions/{parse.quote(session_id)}")
            except PatchCliError:
                pass


def add_global_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--api-url", default=DEFAULT_API_URL, help=f"Backend API base URL. Default: {DEFAULT_API_URL}")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON envelopes.")
    parser.add_argument("--debug", action="store_true", help="Include backend error detail in JSON errors.")
    parser.add_argument("--timeout", type=float, default=20.0, help="Backend request timeout in seconds. Default: 20.")


def add_spec_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("spec", help="Patch spec file in YAML or JSON.")
    parser.add_argument("--name", help="Override patch name.")
    parser.add_argument("--description", help="Override patch description.")
    parser.add_argument("--template", action=argparse.BooleanOptionalAction, default=None, help="Mark patch as an Instrument Design template.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="orchestron_patch_cli",
        description=(
            "Create Orchestron Instrument Design patches from structured sound specs. "
            "The CLI generates Orchestron patch graph JSON, talks to the FastAPI backend, "
            "and can compile-preflight generated patches before create/update."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  orchestron_patch_cli --json health\n"
            "  orchestron_patch_cli --json spec validate fm_pad.yaml\n"
            "  orchestron_patch_cli --json graph render fm_pad.yaml --out graph.json\n"
            "  orchestron_patch_cli --json patch create fm_pad.yaml --name \"Evolving FM Pad\" --compile\n"
            "  orchestron_patch_cli --json patch update PATCH_ID fm_pad.yaml --compile\n\n"
            "Spec principle: generated patches always use cpsmidi for pitch, ampmidi for velocity "
            "with const_i scale 1.0, madsr with const_i ADSR inputs, pan2 for mono-to-stereo, "
            "and outs as the final node. Use top-level formulas: entries to store GUI-compatible "
            "input formulas in graph.ui_layout.input_formulas."
        ),
    )
    add_global_options(parser)
    sub = parser.add_subparsers(dest="command", required=True)

    health = sub.add_parser("health", help="Check backend connectivity.")
    health.set_defaults(func=command_health)

    opcodes = sub.add_parser("opcodes", help="Inspect backend opcode catalog.")
    opcodes_sub = opcodes.add_subparsers(dest="opcodes_command", required=True)
    opcodes_list = opcodes_sub.add_parser("list", help="List available backend opcodes.")
    opcodes_list.add_argument("--category", help="Filter by opcode category.")
    opcodes_list.set_defaults(func=command_opcodes_list)
    opcodes_get = opcodes_sub.add_parser("get", help="Get one opcode by name.")
    opcodes_get.add_argument("name", help="Opcode name.")
    opcodes_get.set_defaults(func=command_opcodes_get)

    templates = sub.add_parser("templates", help="Inspect supported patch template families.")
    templates_sub = templates.add_subparsers(dest="templates_command", required=True)
    templates_list = templates_sub.add_parser("list", help="List supported families and opcodes.")
    templates_list.set_defaults(func=command_templates_list)

    spec = sub.add_parser("spec", help="Validate structured patch specs.")
    spec_sub = spec.add_subparsers(dest="spec_command", required=True)
    spec_validate = spec_sub.add_parser("validate", help="Validate a patch spec and generated graph invariants.")
    add_spec_options(spec_validate)
    spec_validate.set_defaults(func=command_spec_validate)

    graph = sub.add_parser("graph", help="Render generated graph JSON without writing to the backend.")
    graph_sub = graph.add_subparsers(dest="graph_command", required=True)
    graph_render = graph_sub.add_parser("render", help="Render graph JSON from a patch spec.")
    add_spec_options(graph_render)
    graph_render.add_argument("--out", help="Write graph JSON to this path instead of stdout.")
    graph_render.set_defaults(func=command_graph_render)

    patch = sub.add_parser("patch", help="Create, update, inspect, and compile Orchestron patches through the backend.")
    patch_sub = patch.add_subparsers(dest="patch_command", required=True)
    patch_list = patch_sub.add_parser("list", help="List backend patches.")
    patch_list.set_defaults(func=command_patch_list)
    patch_get = patch_sub.add_parser("get", help="Fetch a backend patch.")
    patch_get.add_argument("patch_id", help="Patch ID.")
    patch_get.set_defaults(func=command_patch_get)
    patch_create = patch_sub.add_parser("create", help="Create a backend patch from a spec.")
    add_spec_options(patch_create)
    patch_create.add_argument("--compile", action="store_true", help="Compile-preflight generated graph before creating the final patch.")
    patch_create.set_defaults(func=command_patch_create)
    patch_update = patch_sub.add_parser("update", help="Update an existing backend patch from a spec.")
    patch_update.add_argument("patch_id", help="Patch ID to update.")
    add_spec_options(patch_update)
    patch_update.add_argument("--compile", action="store_true", help="Compile-preflight generated graph before updating the target patch.")
    patch_update.set_defaults(func=command_patch_update)
    patch_compile = patch_sub.add_parser("compile", help="Compile an existing backend patch through a temporary session.")
    patch_compile.add_argument("patch_id", help="Patch ID to compile.")
    patch_compile.set_defaults(func=command_patch_compile)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    ctx = CliContext(api_url=args.api_url, json_output=args.json, debug=args.debug, timeout=args.timeout)
    try:
        args.func(args, ctx)
    except PatchCliError as exc:
        output_error(exc, ctx)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
