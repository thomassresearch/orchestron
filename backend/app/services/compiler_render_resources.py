"""Conservative resource declarations from structured compiler inputs, never CSD text.

This is a compiler-scope audit for candidate planning, not native process safety
qualification. Unknown definitions, tables/assets and unaudited helpers stay single.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import hashlib
import json
import math

from backend.app.models.patch import validate_gen_node_layout_config
from backend.app.models.render_plan import (
    RenderCoLocation, RenderHelper, RenderPlanDiagnostic, RenderResourceAccess,
)
from backend.app.services.compiler_common import CompilationError
from backend.app.services.compiler_formula import lookup_input_formula_config, resolve_input_expression
from backend.app.services.compiler_graph import compile_graph_context
from backend.app.services.compiler_legato import has_legato, validate_legato
from backend.app.services.performance_controller_service import controller_bindings

CAPABILITY_VERSION = "coarse-compiler-resources-v1"

# Freeze semantic definitions (ports/defaults/template), not descriptions/icons.
# Changing opcode support cannot silently inherit a planning classification.
AUDITED_OPCODE_HASHES = {
    "const_a": "739f577a14432bb096581d467eb3e9d62e919a56cdbf924c4cf000a4006ba055",
    "const_i": "0a15a40568044b2fad2fff72fa935865074417fe1f6a4c81fbac46e4e1153c15",
    "const_k": "b85f173e406ad72e065ab0f90a087ad6b55653fed128ad3c0d5735d001b86776",
    "const_s": "9aefc95356eed83ff52ffbbec9b823188fcdfdc09a32686ded3b16e888f80256",
    "cpsmidi": "c19eb2bd281cc46e70e12110a7d8b16a2de501ef9751b30bd4b5dd6efddf6426",
    "ampmidi": "00896a7386e8391dc8ff22b3e5e2ed1c2297df38351281fc33b676f2dc905cf9",
    "notnum": "b7303c2f9a4460ca101e2a05927fa277d35d62260fe34e2bb8f5bf6c7724d3ed",
    "midi_note": "670ddf5f643d2279ed96b84cf81a3087168b5f542f8fa4c389ad39dc452aee6d",
    "vco2": "47259e1beaddc92f47d6f781da5b456a38aebc818b19684b29fea7d4926e0a8e",
    "moogladder": "401d4575a1eac61e4f19627b03df738e63d92988e28bb3ebea4c5571c1dc1ec3",
    "delay": "6a6981a2c9e956b54d191beb22af609c21e30428c8186c08013caf1f8629cba9",
    "inleta": "695125d1444b9c5bb6634a7e8597075b454ba897de40c4e4e7615412411e3880",
    "outleta": "168b12b6e842a0b33bc632106a4971f19cd92b4cb4d9aea4c4699f82d69c506e",
    "outs": "38a16ff297bdf813a1953eb00267eb407ce6a1a8fc01a1d9aeb646f9c6cc96b8",
    "maxalloc": "0d58a359206acec92a3b849a5516d2b48a4f96c9080213ba9132f161884b3554",
    "madsr": "e55598120c97ed46a35ceb26830c2e41c2031e73885076445692037e28b284d4",
    "midi_legato": "19fc9bed9eefa6fa6ff2df59bdfc6d3ef69daefe952d006730839fc5b3b09d0f",
    "perf_controller": "ef053a82f4ffa6d0c4fae04fc226aca9271e45bfa57f4b81e4419167e5616161",
    "ctrl7": "12b6bc986a491af86c049921c0929dda08abde805d593fbd984e2027db35a5a9",
    "midictrl": "0fd466bb78c7a3a3e61e134e936db41f99cf45c456b06cf235084f38cd365d99",
    "initc7": "53f36132369721f6d222b8e08238c5542c4597672039ba9b4d1bcdd8eee6c891",
}
MIDI_READERS = frozenset({"cpsmidi", "ampmidi", "notnum", "midi_note", "midi_legato", "ctrl7", "midictrl"})


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
    for index, target in enumerate(targets, 1):
        identity = target.assignment_id or f"instrument-{index}"
        stage, patch = "patch:" + identity, target.patch
        validate_legato(patch)
        if has_legato(patch) and target.always_on:
            raise CompilationError(["midi_legato cannot be assigned as a continuous instrument."])
        context = compile_graph_context(patch.graph, opcode_service)
        controllers = controller_bindings(target, identity)
        layout = patch.graph.ui_layout
        variables = {(node.node.id, port.id): f"v_{n}_{p}"
                     for n, node in enumerate(context.compiled_nodes.values()) for p, port in enumerate(node.spec.outputs)}

        def block(code, node, detail):
            blockers.append(RenderPlanDiagnostic(code, f"{identity}/{node.id}: {detail}", (stage,)))

        def resource(key, node, scope, access):
            accesses.append(RenderResourceAccess(key, stage, node.id, scope, access))

        for compiled in context.compiled_nodes.values():
            node, spec = compiled.node, compiled.spec
            name = spec.name
            hashes[name] = opcode_semantic_hash(spec)
            for port in spec.inputs:
                if lookup_input_formula_config(layout, f"{node.id}::{port.id}") is not None:
                    # The existing parser only permits arithmetic, bound inputs and
                    # its explicit pure unary functions. It rejects arbitrary code.
                    resolve_input_expression(layout, node.id, port.id,
                        context.inbound_index.get((node.id, port.id), []), variables)
                if port.id == "ifn" or port.id.startswith("ifn") and port.id[3:].isdigit():
                    value, static = _static_input(node, port, context, layout)
                    if static and value in (None, 0):
                        continue
                    numbered = (static and isinstance(value, (int, float)) and not isinstance(value, bool)
                                and math.isfinite(value) and value > 0 and value == int(value))
                    key = f"table:{int(value)}" if numbered else "tables:*"
                    resource(key, node, "performance" if numbered else "unknown", "read")
                    table_users[key].add(stage)
                    block("table_access_unqualified", node, "Table ownership/lifetime requires further qualification.")
            if name == "GEN":
                try:
                    config = validate_gen_node_layout_config(_node_layout(layout, "gen_nodes", node.id))
                except ValueError as exc:
                    raise CompilationError([f"Invalid GEN node config for '{node.id}': {exc}"]) from exc
                key = f"table:{config.table_number}" if config.table_number > 0 else "tables:*"
                resource(key, node, "performance", "read_write")
                table_users[key].add(stage)
                block("table_lifetime_unqualified", node, "GEN allocation/deduplication and initialization remain unqualified.")
            elif name in {"sfload", "sfplay3", "sfinstr3", "adsyn"}:
                config = _node_layout(layout, f"{name}_nodes", node.id)
                resource("asset:" + name + ":" + stable_hash(config), node, "unknown", "read_write")
                block("asset_state_unqualified", node, "Asset identity, native handles and replicated memory require qualification.")
            elif name not in AUDITED_OPCODE_HASHES:
                resource("unknown:" + name, node, "unknown", "read_write")
                block("opcode_unclassified", node, f"Opcode/helper '{name}' has no compiler resource audit.")
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
    for key, stages in sorted(table_users.items()):
        colocations.append(RenderCoLocation(tuple(sorted(stages)), "shared_" + key))
    return RenderResourceAnalysis(
        tuple(sorted(accesses, key=lambda r: (r.resource, r.stage, r.node, r.access))),
        tuple(sorted(colocations, key=lambda c: (c.reason, c.stages))),
        tuple(sorted(helpers, key=lambda h: h.id)),
        tuple(sorted(blockers, key=lambda d: (d.code, d.stages, d.detail))), tuple(sorted(hashes.items())),
    )
