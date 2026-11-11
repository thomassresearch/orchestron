"""Whole-instrument resource effects from structured inputs, never sliced CSD.

Voice state stays inside its instrument; only engine-wide state constrains owners.
Unknown native effects and unbounded allocations retain the single fallback.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, replace
import hashlib
import json
import math
from pathlib import Path
import re

from backend.app.models.opcode import SignalType
from backend.app.models.patch import validate_gen_node_layout_config
from backend.app.models.render_plan import (
    RenderCoLocation, RenderHelper, RenderPlanDiagnostic, RenderResourceAccess,
)
from backend.app.services.compiler_common import CompilationError
from backend.app.services.compiler_formula import lookup_input_formula_config, resolve_input_expression
from backend.app.services.compiler_graph import compile_graph_context
from backend.app.services.compiler_legato import has_legato, validate_legato
from backend.app.services.performance_controller_service import controller_bindings
from backend.app.services.compiler_private_tables import TABLE_CACHE_ENTRIES, input_bounds, private_table_size

CAPABILITY_VERSION = "whole-instrument-resources-v4"

# Semantic identities bind the resource rules to shipped compiler definitions.
# Ordinary filters, arithmetic, envelopes and internal branches remain intact.
# This is compiler maintenance metadata, never a user/performance allowlist.
AUDITED_OPCODE_HASHES = json.loads((Path(__file__).resolve().parents[1] / "data" / "render_resource_semantics.json").read_text())

# These opcodes consume Csound's shared random stream (including initialization).
# Keep consumers together so splitting does not duplicate/correlate that stream.
RANDOM_STATE_USERS = frozenset({"jitter", "random", "randomh", "randomi", "noise", "pinker", "pinkish",
    "sekere", "sleighbells", "dripwater", "grain", "grain2", "granule", "vibr", "vibrato",
    "waveguide_string", "swept_gate", "pluck", "marimba", "wgclar", "wgflute", "wgbow", "wgbowedbar", "prepiano"})
TABLE_PORTS = frozenset({"ifn", "ifn1", "ifn2", "ifn3", "ifn4", "ifna", "ifnb", "ifnenv",
    "ivfn", "ivibfn", "igfn", "iwfn", "kfn", "iafn", "ioctfn", "imp", "irattles", "irubbers"})
MIDI_READERS = frozenset({"cpsmidi", "ampmidi", "notnum", "midi_note", "midi_legato", "ctrl7", "midictrl"})
PURE_EXPRESSION_NAMES = frozenset({"sr", "kr", "ksmps", "nchnls", "0dbfs", "A4", "i", "k", "a",
    "abs", "ceil", "floor", "int", "frac", "round", "sqrt", "exp", "log", "log10", "log2",
    "sin", "cos", "tan", "sinh", "cosh", "tanh", "sininv", "cosinv", "taninv", "ampdb", "ampdbfs",
    "dbamp", "dbfsamp", "cpsmidinn", "cpsoct", "cpspch", "octcps", "octpch", "pchcps", "pchoct"})


def expression_names(value):
    """Numeric literals also accept Csound scalar expressions, unlike formula bindings."""
    tokens = re.findall(r"0dbfs|[A-Za-z_][A-Za-z_0-9]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?", value)
    return {token for token in tokens if token == "0dbfs" or token[0].isalpha() or token[0] == "_"}


def stable_hash(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def opcode_semantic_hash(spec) -> str:
    return stable_hash(spec.model_dump(mode="json", include={"name", "inputs", "outputs", "template"}))


def _node_layout(layout, key, node_id):
    nodes = layout.get(key)
    config = nodes.get(node_id) if isinstance(nodes, dict) else None
    return config if isinstance(config, dict) else {}


@dataclass(frozen=True, slots=True)
class RenderResourceAnalysis:
    accesses: tuple[RenderResourceAccess, ...]
    colocations: tuple[RenderCoLocation, ...]
    helpers: tuple[RenderHelper, ...]
    blockers: tuple[RenderPlanDiagnostic, ...]
    opcode_hashes: tuple[tuple[str, str], ...]


def _static_input(node, port, context, layout):
    if lookup_input_formula_config(layout, f"{node.id}::{port.id}") is not None:
        return None, False
    links = context.inbound_index.get((node.id, port.id), [])
    if links:
        source = context.compiled_nodes[links[0].from_node_id].node
        if len(links) != 1 or source.opcode != "const_i" or links[0].from_port_id != "iout":
            return None, False
        return source.params.get("value", 0), True
    return node.params.get(port.id, port.default), True


def analyze_render_resources(targets, opcode_service) -> RenderResourceAnalysis:
    accesses, colocations, helpers, blockers = [], [], [], []
    hashes, legato_stages, midi_stages, midi_initializers = {}, [], set(), set()
    table_users = defaultdict(set)
    table_writers = set()
    table_resources = []
    private_allocations = []
    for index, target in enumerate(targets, 1):
        identity = target.assignment_id or f"instrument-{index}"
        stage, patch = "patch:" + identity, target.patch
        validate_legato(patch)
        if has_legato(patch) and target.always_on:
            raise CompilationError(["midi_legato cannot be assigned as a continuous instrument."])
        context = compile_graph_context(patch.graph, opcode_service)
        controllers = controller_bindings(target, identity, opcode_service)
        layout = patch.graph.ui_layout
        private_tables = {c.node.id: size for c in context.compiled_nodes.values()
                          if (size := private_table_size(c, context, layout,
                              lambda spec: AUDITED_OPCODE_HASHES.get(spec.name) == opcode_semantic_hash(spec))) is not None}
        variables = {(node.node.id, port.id): f"v_{n}_{p}"
                     for n, node in enumerate(context.compiled_nodes.values()) for p, port in enumerate(node.spec.outputs)}

        def block(code, node, detail):
            blockers.append(RenderPlanDiagnostic(code, f"{identity}/{node.id}: {detail}", (stage,)))

        def resource(key, node, scope, access, memory_bytes=0):
            accesses.append(RenderResourceAccess(key, stage, node.id, scope, access, memory_bytes))

        def table(key, node, access, memory_bytes=0):
            table_resources.append(len(accesses))
            resource(key, node, "performance", access, memory_bytes)
            table_users[key].add(stage)
            if access != "read":
                table_writers.add(key)

        def inspect_expression(node, value):
            if not isinstance(value, str):
                return
            identifiers = expression_names(value)
            if identifiers & {"rnd", "birnd"}:
                resource("engine:random", node, "performance", "read_write")
            unknown = {n for n in identifiers - PURE_EXPRESSION_NAMES - {"rnd", "birnd"}
                       if not re.fullmatch(r"p\d+", n)}
            if unknown:
                resource("expression:" + identity + ":" + node.id, node, "unknown", "read_write")
                block("expression_state_unknown", node, "Scalar expression uses unmodeled native state: " + ", ".join(sorted(unknown)))

        for compiled in context.compiled_nodes.values():
            node, spec = compiled.node, compiled.spec
            name = spec.name
            hashes[name] = opcode_semantic_hash(spec)
            # Constants have no input port; madsr retains an old release alias.
            if name in {"const_a", "const_i", "const_k"}:
                inspect_expression(node, node.params.get("value", 0))
            if name == "madsr" and "idrss" in node.params:
                inspect_expression(node, node.params["idrss"])
            for port in spec.inputs:
                value, static = _static_input(node, port, context, layout)
                if static and port.signal_type != SignalType.STRING:
                    inspect_expression(node, value)
                if lookup_input_formula_config(layout, f"{node.id}::{port.id}") is not None:
                    # The existing parser only permits arithmetic, bound inputs and
                    # its explicit pure unary functions. It rejects arbitrary code.
                    resolve_input_expression(layout, node.id, port.id,
                        context.inbound_index.get((node.id, port.id), []), variables)
                if name in {"pvsanal", "pvsosc"} and port.id == "iwintype":
                    value, static = _static_input(node, port, context, layout)
                    if not static:
                        table("tables:*", node, "read")
                    elif isinstance(value, (int, float)) and value < 0:
                        table(f"table:{int(abs(value))}", node, "read")
                if port.id in TABLE_PORTS and name != "GEN":
                    links = context.inbound_index.get((node.id, port.id), [])
                    if len(links) == 1 and links[0].from_node_id in private_tables:
                        resource(f"private-table:{identity}:{links[0].from_node_id}", node, "instance", "read")
                        continue
                    value, static = _static_input(node, port, context, layout)
                    if static and value in (None, 0, -1):
                        # Zero denotes an opcode-owned/default table; -1 is the
                        # immutable native sine table, not a shared mutable ID.
                        continue
                    numbered = (static and isinstance(value, (int, float)) and not isinstance(value, bool)
                                and math.isfinite(value) and value > 0 and value == int(value))
                    key = f"table:{int(value)}" if numbered else "tables:*"
                    table(key, node, "read")
            if name == "ftgenonce" and node.id in private_tables:
                private_allocations.append((len(accesses), private_tables[node.id]))
                resource(f"private-table:{identity}:{node.id}", node, "instance", "read_write")
            elif name == "ftgenonce":
                block("ftgenonce_ownership_unknown", node, "Table size, generator or private read-only handle ownership is not proven.")
            elif name == "GEN":
                try:
                    config = validate_gen_node_layout_config(_node_layout(layout, "gen_nodes", node.id))
                except ValueError as exc:
                    raise CompilationError([f"Invalid GEN node config for '{node.id}': {exc}"]) from exc
                key = f"table:{config.table_number}" if config.table_number > 0 else "tables:*"
                table(key, node, "read_write")
                resource("allocation:gen:" + identity + ":" + node.id, node, "instance", "read_write", (config.table_size + 1) * 8)
                # Numbered definitions can be replaced at note initialization;
                # all readers/writers stay with the defining instrument. Auto
                # allocation changes table IDs, so it joins the table domain.
                if config.table_number == 0 and config.mode != "ftgenonce":
                    block("unbounded_table_allocation", node, "Per-note automatic ftgen has no bounded lifetime; retain single rendering.")
                if config.is_gen01_routine or config.table_size <= 0:
                    block("asset_memory_unknown", node, "Sample-backed table allocation needs a bounded native memory estimate.")
                elif (config.routine_name or config.routine_number not in {2, 5, 7, 9, 10, 11, 16, 17, 19, 20}
                      or config.raw_args or config.raw_args_text):
                    block("table_generator_state_unknown", node, "This table generator may read additional engine state.")
            elif name in {"sfload", "sfplay3", "sfinstr3", "adsyn"}:
                config = _node_layout(layout, f"{name}_nodes", node.id)
                resource("asset:" + name + ":" + stable_hash(config), node, "unknown", "read_write")
                block("asset_state_unqualified", node, "Asset identity, native handles and replicated memory require qualification.")
            elif name in {"CaseResult", "If", "Switch"}:
                pass  # Compiler-generated branch result; no Csound state.
            elif name not in AUDITED_OPCODE_HASHES:
                resource("unknown:" + name, node, "unknown", "read_write")
                block("opcode_unclassified", node, f"Engine resource semantics for '{name}' are not described.")
            elif hashes[name] != AUDITED_OPCODE_HASHES[name]:
                resource("unknown:" + name, node, "unknown", "read_write")
                block("opcode_definition_changed", node, f"Opcode '{name}' differs from the audited semantic definition.")
            elif name == "perf_controller":
                resource("channel:" + controllers[node.id]["channel"], node, "host", "read")
            elif name == "maxalloc":
                resource("allocation:" + identity, node, "instance", "read_write")
                helpers.append(RenderHelper("maxalloc:" + identity + ":" + node.id, (stage,)))
            elif name == "initc7":
                midi_initializers.add(stage)
                resource("midi:controller-state", node, "performance", "write")
            elif name in MIDI_READERS:
                midi_stages.add(stage)
                resource("midi:ordered-stream", node, "host", "subscribe")
                if name == "midi_legato":
                    legato_stages.append(stage)
                    resource("legato:" + identity, node, "instance", "read_write")
            elif name not in {"outs", "inleta", "outleta", "const_a", "const_i", "const_k", "const_s"}:
                resource("voice:" + identity + ":" + node.id, node, "voice", "read_write")

            if name in RANDOM_STATE_USERS:
                resource("engine:random", node, "performance", "read_write")
            if name == "grain3":
                seed = input_bounds(node, next(p for p in spec.inputs if p.id == "iseed"), context, layout)
                if seed is None or not (1 <= seed[0] <= seed[1] <= 2147483646):
                    block("grain3_seed_unproven", node, "A positive bounded seed is required; clock-seeded grain3 cannot preserve parallel parity.")

    if legato_stages:
        # The current compiler has ONE shared panic listener. Keep all consumers
        # together until T04 proves an equivalent per-owner helper lowering.
        stages = tuple(sorted(legato_stages))
        colocations.append(RenderCoLocation(stages, "shared_legato_panic_listener"))
        helpers.append(RenderHelper("legato:panic", stages, "1"))
        for number, stage in enumerate(legato_stages, 2):
            helpers.append(RenderHelper("legato:collector:" + stage[6:], (stage,), str(number)))
    if midi_initializers:
        colocations.append(RenderCoLocation(tuple(sorted(midi_stages | midi_initializers)), "midi_controller_initialization"))
    # The canonical score initializes table 1 in every program. Read-only users
    # can replicate it. A writer (or dynamic reference) restores shared ownership.
    wildcard = "tables:*" in table_users
    if private_allocations:
        # Numeric/dynamic references could observe auto IDs or mutate a cached table.
        if set(table_users) - {"table:1"} or table_writers:
            blockers.append(RenderPlanDiagnostic("private_table_alias_unknown", "Automatic private tables coexist with unresolved or mutable table references."))
        largest = max(size for _, size in private_allocations)
        for index, _ in private_allocations:
            # A program-wide auto-ID guard permits pooled cache entries of any size.
            accesses[index] = replace(accesses[index], memory_bytes=(TABLE_CACHE_ENTRIES + 1) * ((largest + 1) * 8 + 4096))
    if not wildcard and "table:1" not in table_writers:
        for index in table_resources:
            access = accesses[index]
            if access.resource == "table:1":
                accesses[index] = replace(access, scope="replicated")
        table_users.pop("table:1", None)
    if wildcard:
        colocations.append(RenderCoLocation(tuple(sorted(set().union(*table_users.values()))), "dynamic_table_domain"))
    for key, stages in sorted(table_users.items()):
        colocations.append(RenderCoLocation(tuple(sorted(stages)), "shared_" + key))
    return RenderResourceAnalysis(
        tuple(sorted(accesses, key=lambda r: (r.resource, r.stage, r.node, r.access))),
        tuple(sorted(colocations, key=lambda c: (c.reason, c.stages))),
        tuple(sorted(helpers, key=lambda h: h.id)),
        tuple(sorted(blockers, key=lambda d: (d.code, d.stages, d.detail))), tuple(sorted(hashes.items())),
    )
