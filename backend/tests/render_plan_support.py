"""Planner fixture variants; no examples, storage or native engines."""
from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from backend.app.models.audio import AudioInterface, AudioPortGroup, AudioRoute
from backend.app.models.patch import NodeInstance, PatchDocument, PatchGraph
from backend.app.models.render_plan import RenderCostProfile, RenderStageCost
from backend.app.services.compiler_common import PatchInstrumentTarget
from backend.tools._parallel_render_workload import build_workload_inputs, connection, load_workloads

FIXTURE_DIR = Path(__file__).parent / "fixtures/parallel_render"
FIXTURES = json.loads((FIXTURE_DIR / "planner_cases.json").read_text())
CASES = {case["id"]: case for case in FIXTURES["cases"]}


def plan_snapshot(plan):
    """Readable ownership/bus snapshots; the digest additionally freezes all graph metadata."""
    data = asdict(plan)
    data["graph"] = {"input_hash": plan.graph.input_hash, "stages": [s.id for s in plan.graph.stages]}
    data.pop("cost_profile")
    return data


def planner_inputs(case_id, ksmps=32):
    case = CASES[case_id]
    targets, graph, mixer, _ = build_workload_inputs(load_workloads()[case["base"]], ksmps)
    sources = [target for target in targets if target.assignment_id.startswith("source")]
    variant = case["variant"]

    def route(identity, source, output, target, inlet, **kwargs):
        graph.routes.append(AudioRoute(id=identity, sourceId=source, sourcePort=output,
                                       targetId=target, targetPort=inlet, **kwargs))

    if variant == "bypass":
        for identity, owner in (("insert0", "source0"), ("masterInsert", "$master")):
            patch_graph = PatchGraph.model_validate(FIXTURES["stereo_insert"])
            patch_graph.engine_config = targets[0].patch.graph.engine_config.model_copy(deep=True)
            targets.append(PatchInstrumentTarget(PatchDocument(id=identity, name=identity, always_on=True,
                graph=patch_graph), 0, identity, True))
            graph.insert_owners[identity] = owner
            for side in ("left", "right"):
                route(identity + "in" + side, owner, "$direct." + side, identity, side, sourceStage="raw", kind="insert")
                route(identity + "out" + side, identity, side, owner, "$direct." + side, targetStage="strip", kind="insert")
    elif variant == "sidechain":
        nodes = [NodeInstance(id="main", opcode="inleta", params={"sname": "main"}),
                 NodeInstance(id="side", opcode="inleta", params={"sname": "side"}),
                 NodeInstance(id="out", opcode="outleta", params={"sname": "out"})]
        patch = PatchDocument(id="sidechain", name="Sidechain", always_on=True, graph=PatchGraph(
            nodes=nodes, connections=[connection(n, "asignal", "out", "asignal") for n in ("main", "side")],
            audio_interface=AudioInterface(groups=[
                AudioPortGroup(id="main", name="Main", direction="input", layout="mono", ports=["main"]),
                AudioPortGroup(id="side", name="Side", direction="input", layout="mono", purpose="sidechain", ports=["side"])])))
        targets.append(PatchInstrumentTarget(patch, 0, "sidechain", True))
        route("main-sidechain", "source0", "$direct.left", "sidechain", "main")
        route("side-sidechain", "source1", "$direct.right", "sidechain", "side", sourceStage="raw")
        for side in ("left", "right"):
            route("sidechain-return-" + side, "sidechain", "out", "$master", side)
    elif variant == "custom_ports":
        patch = sources[0].patch.graph
        patch.nodes.append(NodeInstance(id="out2", opcode="outs"))
        patch.connections.extend(link.model_copy(update={"to_node_id": "out2"})
                                 for link in list(patch.connections) if link.to_node_id == "out")
        signal = next(link for link in patch.connections if link.to_node_id == "out")
        for name, side in (("b", "left"), ("a", "right")):
            patch.nodes.append(NodeInstance(id=name, opcode="outleta", params={"sname": name}))
            patch.connections.append(connection(signal.from_node_id, signal.from_port_id, name, "asignal"))
            route("custom-" + name, "source0", name, "$master", side, sourceStage="raw")
        patch.audio_interface = AudioInterface(groups=[AudioPortGroup(
            id="custom", name="Reordered", direction="output", layout="custom", ports=["b", "a", "$direct.right", "$direct.left"])])
    elif variant == "unknown":
        sources[0].patch.graph.nodes.append(NodeInstance(id="noise", opcode="noise"))
    elif variant in {"tables", "dynamic_table"}:
        for source in sources[:2]:
            patch = source.patch.graph
            patch.nodes.append(NodeInstance(id="table", opcode="GEN"))
            patch.ui_layout["gen_nodes"] = {"table": {"tableNumber": 7 if variant == "tables" else 0}}
            if variant == "tables":
                next(n for n in patch.nodes if n.id == "amp").params["ifn"] = 7
            else:
                patch.connections.append(connection("table", "ift", "amp", "ifn"))
    elif variant == "legato":
        for source in sources[:2]:
            source.patch.graph.nodes.extend([NodeInstance(id="legato", opcode="midi_legato"),
                                              NodeInstance(id="envelope", opcode="madsr"),
                                              NodeInstance(id="limit", opcode="maxalloc")])
    elif variant == "midi_initialization":
        sources[0].patch.graph.nodes.append(NodeInstance(id="init", opcode="initc7"))
        sources[1].patch.graph.nodes.append(NodeInstance(id="cc", opcode="ctrl7", params={"ichan": 1}))
    elif variant == "disconnected":
        patch = targets[1].patch.model_copy(deep=True)
        patch.id = "disconnected"
        targets.append(PatchInstrumentTarget(patch, 0, "disconnected", True))
    elif variant == "legacy":
        graph = None
    elif variant == "asset":
        sources[0].patch.graph.nodes.append(NodeInstance(id="asset", opcode="sfload"))
        sources[0].patch.graph.ui_layout["sfload_nodes"] = {"asset": {"sampleAsset": {"id": "test-asset"}}}
    elif variant != "none":
        raise AssertionError(variant)
    return targets, graph, mixer


def synthetic_costs(graph):
    values = FIXTURES["synthetic_costs"]
    return RenderCostProfile("synthetic-planner-fixture-v1; not measured or qualified",
        tuple(RenderStageCost(s.id, values["source"] if s.kind == "patch" and (s.instance_id or "").startswith("source")
                              else values["effect"] if s.kind == "patch" else values["mixer_stage"]) for s in graph.stages),
        values["dispatch"], values["copy_per_sample"])
