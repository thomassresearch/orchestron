"""Lower the explicit performance graph to ordered Csound patches and audio strips.

The graph and control manifest are also used by runtime updates and offline export.
No patch definitions are mutated by this lowering.
"""

from __future__ import annotations

from collections import defaultdict
from hashlib import sha256
import heapq
import math

from backend.app.models.audio import (
    AudioDiagnostic,
    AudioGraph,
    AudioRoute,
    MixerSend,
    MixerState,
    MixerStrip,
    linear_gain,
    legacy_gain,
)
from backend.app.models.session import CompileArtifact
from backend.app.services.audio_port_names import audio_port_names
from backend.app.services.audio_routing_service import resolve_audio_routes
from backend.app.services.compiler_common import CompilationError
from backend.app.services.compiler_graph import compile_graph_context, resolve_shared_engine, validate_target_channels
from backend.app.services.performance_controller_service import controller_bindings


OUTPUT = "$output"


def token(value: str) -> str:
    return sha256(value.encode()).hexdigest()[:24]


def channel(kind: str, identity: str, control: str) -> str:
    return f"__vcs_mixer_{kind}_{token(identity)}_{control}"


def port(value: str) -> str:
    return "p_" + token(value)


def legacy_audio_graph(targets) -> AudioGraph:
    return AudioGraph(
        routes=[
            AudioRoute(
                id="legacy_" + token("\0".join((r.source_assignment_id, r.source_port_name, r.target_assignment_id))),
                sourceId=r.source_assignment_id,
                sourcePort=r.source_port_name,
                targetId=r.target_assignment_id,
                targetPort=r.target_port_name,
            )
            for r in resolve_audio_routes(targets)
        ]
    )


def normalize_audio_inputs(targets, graph, mixer, levels):
    """Compatibility boundary shared by session validation, creation and export."""
    has_levels = any(value is not None for value in levels)
    has_legacy_routes = any(t.effect_routes or t.effect_source_ids for t in targets)
    if graph is not None:
        if has_levels or has_legacy_routes:
            raise CompilationError(["Do not combine legacy Level/routing and the explicit audio graph."])
        return graph, mixer
    if not has_levels and not mixer.strips and not mixer.sends:
        return graph, mixer
    if has_levels and mixer.strips:
        raise CompilationError(["Legacy Level and mixer gain cannot both be supplied."])
    strips = dict(mixer.strips)
    if has_levels:
        strips = {
            t.assignment_id: MixerStrip(gainDb=legacy_gain(value)) for t, value in zip(targets, levels, strict=True)
        }
    return legacy_audio_graph(targets), MixerState(strips=strips, sends=mixer.sends)


def _reachable(start: str, adjacency: dict[str, list[str]]) -> set[str]:
    seen, todo = set(), [start]
    while todo:
        current = todo.pop()
        if current not in seen:
            seen.add(current)
            todo.extend(adjacency.get(current, []))
    return seen


class ResolvedMixerGraph:
    def __init__(self, targets, graph: AudioGraph):
        self.targets = targets
        self.graph = graph
        self.by_id = {t.assignment_id: t for t in targets}
        if None in self.by_id or len(self.by_id) != len(targets):
            raise CompilationError(["Audio mixing requires unique, stable instance IDs."])
        if len(targets) > 64:
            raise CompilationError(["A performance supports at most 64 patch instances."])
        self.raw_ports: dict[str, dict[str, list[str]]] = {}
        self.direct_ports: dict[str, dict[str, tuple[str, str]]] = {}
        self.sides: dict[str, dict[str, str]] = {}
        self.mono_ports: dict[str, set[str]] = {}
        self.route_pans: dict[str, str] = {}
        self.sidechain_routes: list[str] = []
        self.diagnostics: list[AudioDiagnostic] = []
        self.edges: list[tuple[str, str]] = []
        self.routes = list(graph.routes)
        errors = []
        for identity, target in self.by_id.items():
            names = audio_port_names(target.patch.graph, opcode="outleta")
            if any(
                name.startswith("__vcs_") for name in [*names, *audio_port_names(target.patch.graph, opcode="inleta")]
            ):
                errors.append(f"Patch '{target.patch.name}' uses the reserved __vcs_ audio namespace.")
            raw = {name: [name] for name in names}
            direct = {}
            for node in target.patch.graph.nodes:
                if node.opcode == "outs":
                    pair = tuple(f"__vcs_direct_{token(node.id)}_{side}" for side in ("left", "right"))
                    direct[node.id] = pair
                    for side, name in zip(("left", "right"), pair, strict=True):
                        raw.setdefault(f"$direct.{side}", []).append(name)
            self.raw_ports[identity] = raw
            self.direct_ports[identity] = direct
            sides = {}
            lower = {name.lower(): name for name in raw}
            for name in raw:
                n = name.lower()
                if n in {"l", "left"} or n.endswith("left") or (n.endswith("l") and n[:-1] + "r" in lower):
                    sides[name] = "left"
                elif n in {"r", "right"} or n.endswith("right") or (n.endswith("r") and n[:-1] + "l" in lower):
                    sides[name] = "right"
            self.mono_ports[identity] = set()
            interface = target.patch.graph.audio_interface
            if interface:
                for group in interface.groups:
                    available = (
                        raw if group.direction == "output" else audio_port_names(target.patch.graph, opcode="inleta")
                    )
                    if any(name not in available for name in group.ports):
                        errors.append(f"Patch '{target.patch.name}' has a broken audio group '{group.name}'.")
                    if group.direction == "output" and group.layout == "mono":
                        self.mono_ports[identity].update(group.ports)
                        for p in group.ports:
                            sides.pop(p, None)
                    if group.direction == "output" and group.layout == "stereo" and len(group.ports) == 2:
                        sides.update(dict(zip(group.ports, ("left", "right"), strict=True)))
            self.sides[identity] = sides
            for name in raw:
                replaced = any(
                    r.target_id == identity and r.target_stage == "strip" and r.target_port == name for r in self.routes
                )
                if not replaced:
                    self.edges.append((f"patch:{identity}", f"strip:{identity}"))
            for side in ("left", "right"):
                name = f"$direct.{side}"
                redirected = any(
                    r.source_id == identity and r.source_port == name and r.kind == "main" for r in self.routes
                )
                if name in raw and not redirected:
                    self.routes.append(
                        AudioRoute(
                            id="direct_" + token(identity + side),
                            sourceId=identity,
                            sourcePort=name,
                            targetId=OUTPUT,
                            targetPort=side,
                            kind="main",
                        )
                    )
        if graph.master_id is not None and graph.master_id not in self.by_id:
            errors.append("Master references a missing rack instance.")
        for route in self.routes:
            if route.source_id not in self.by_id or route.source_port not in self.raw_ports.get(route.source_id, {}):
                errors.append(f"Route '{route.id}' references a missing source or output '{route.source_port}'.")
            if route.target_id == OUTPUT:
                if route.target_port not in {"left", "right"}:
                    errors.append(f"Route '{route.id}' must select the left or right audio output.")
            elif route.target_id not in self.by_id:
                errors.append(f"Route '{route.id}' references a missing destination.")
            else:
                ports = (
                    self.raw_ports[route.target_id]
                    if route.target_stage == "strip"
                    else audio_port_names(self.by_id[route.target_id].patch.graph, opcode="inleta")
                )
                if route.target_port not in ports:
                    errors.append(f"Route '{route.id}' references missing destination port '{route.target_port}'.")
            source_stage = ("patch" if route.source_stage == "raw" else "strip") + ":" + route.source_id
            target_stage = (
                OUTPUT
                if route.target_id == OUTPUT
                else ("patch" if route.target_stage == "input" else "strip") + ":" + route.target_id
            )
            self.edges.extend([(source_stage, "route:" + route.id), ("route:" + route.id, target_stage)])
        # Equal-power pan is only introduced by an explicit mono-to-stereo pair.
        for route in self.routes:
            if route.source_port not in self.mono_ports.get(route.source_id, set()) or route.source_stage != "strip":
                continue
            target = self.by_id.get(route.target_id)
            interface = target.patch.graph.audio_interface if target else None
            stereo_groups = (
                [["left", "right"]]
                if route.target_id == OUTPUT
                else [
                    g.ports
                    for g in (interface.groups if interface else [])
                    if g.direction == "input" and g.layout == "stereo"
                ]
            )
            for pair in stereo_groups:
                if route.target_port in pair and all(
                    any(
                        r.source_id == route.source_id
                        and r.source_port == route.source_port
                        and r.target_id == route.target_id
                        and r.target_port == p
                        and r.kind == route.kind
                        for r in self.routes
                    )
                    for p in pair
                ):
                    self.route_pans[route.id] = "left" if route.target_port == pair[0] else "right"
        for route in self.routes:
            target = self.by_id.get(route.target_id)
            interface = target.patch.graph.audio_interface if target else None
            if interface and any(g.purpose == "sidechain" and route.target_port in g.ports for g in interface.groups):
                self.sidechain_routes.append(route.id)
        for processor, owner in graph.insert_owners.items():
            if processor not in self.by_id or owner not in self.by_id or processor == owner:
                errors.append("Insert ownership references a missing or invalid instance.")
        if len({r.id for r in self.routes}) != len(self.routes):
            errors.append("An explicit route ID collides with a generated direct-output route ID.")
        if errors:
            raise CompilationError(errors)
        stages = {
            OUTPUT,
            *("patch:" + i for i in self.by_id),
            *("strip:" + i for i in self.by_id),
            *("route:" + r.id for r in self.routes),
        }
        adjacency: dict[str, list[str]] = defaultdict(list)
        indegree = dict.fromkeys(stages, 0)
        for source, dest in set(self.edges):
            adjacency[source].append(dest)
            indegree[dest] += 1
        ready = [s for s in stages if not indegree[s]]
        heapq.heapify(ready)
        self.order = []
        while ready:
            current = heapq.heappop(ready)
            self.order.append(current)
            for dest in adjacency[current]:
                indegree[dest] -= 1
                if not indegree[dest]:
                    heapq.heappush(ready, dest)
        if len(self.order) != len(stages):
            raise CompilationError(["Effect routing would create an audio feedback loop."])
        self.adjacency = adjacency
        for identity, target in self.by_id.items():
            if OUTPUT not in _reachable("patch:" + identity, adjacency):
                self.diagnostics.append(
                    AudioDiagnostic(
                        code="no_output_path",
                        instanceId=identity,
                        message=f"{target.patch.name}: no path to audio output.",
                    )
                )
            inlets = audio_port_names(target.patch.graph, opcode="inleta")
            if inlets and not any(r.target_id == identity and r.target_stage == "input" for r in self.routes):
                self.diagnostics.append(
                    AudioDiagnostic(
                        code="no_audio_source",
                        instanceId=identity,
                        message=f"{target.patch.name}: no connected audio source.",
                    )
                )
            if any(r.source_id == identity and r.target_id == OUTPUT for r in self.routes) and any(
                r.source_id == identity and r.target_id != OUTPUT for r in self.routes
            ):
                self.diagnostics.append(
                    AudioDiagnostic(
                        code="parallel_output",
                        instanceId=identity,
                        message=f"{target.patch.name}: direct and routed output paths are both present.",
                    )
                )

        for identity, target in self.by_id.items():
            interface = target.patch.graph.audio_interface
            for direction, ports in (
                ("input", audio_port_names(target.patch.graph, opcode="inleta")),
                ("output", list(self.raw_ports[identity])),
            ):
                connected = {
                    r.target_port if direction == "input" else r.source_port
                    for r in self.routes
                    if (r.target_id if direction == "input" else r.source_id) == identity
                }
                unused = set(ports) - connected
                if unused:
                    self.diagnostics.append(
                        AudioDiagnostic(
                            code="unconnected_" + direction,
                            instanceId=identity,
                            message=f"{target.patch.name}: unconnected {direction} ports: {', '.join(sorted(unused))}.",
                        )
                    )
                groups = [
                    g.ports
                    for g in (interface.groups if interface else [])
                    if g.direction == direction and g.layout == "stereo"
                ]
                if not groups and {"left", "right"}.issubset(ports):
                    groups = [["left", "right"]]
                for pair in groups:
                    if 0 < len(set(pair) & connected) < len(pair):
                        self.diagnostics.append(
                            AudioDiagnostic(
                                code="incomplete_stereo",
                                instanceId=identity,
                                message=f"{target.patch.name}: incomplete stereo {direction}: {' / '.join(pair)}.",
                            )
                        )

    def manifest(self) -> dict:
        return {
            "instanceIds": list(self.by_id),
            "routeIds": [r.id for r in self.graph.routes],
            "routes": [r.model_dump(by_alias=True) for r in self.routes],
            "edges": self.edges,
            "masterId": self.graph.master_id,
            "sides": self.sides,
            "routePans": self.route_pans,
            "sidechainRoutes": self.sidechain_routes,
            "instrumentReferences": {
                identity: str(self.order.index("patch:" + identity) + 1) for identity in self.by_id
            },
            "meters": {
                identity: {key: channel("meter", identity, key) for key in ("peakL", "peakR", "rmsL", "rmsR")}
                for identity in [*self.by_id, OUTPUT]
            },
        }


def mixer_control_values(manifest: dict, mixer: MixerState) -> dict[str, float]:
    values = {}
    adjacency: dict[str, list[str]] = defaultdict(list)
    reverse: dict[str, list[str]] = defaultdict(list)
    for source, dest in manifest["edges"]:
        adjacency[source].append(dest)
        reverse[dest].append(source)
    solos = ["strip:" + i for i, s in mixer.strips.items() if s.solo and i != manifest.get("masterId")]
    active_routes = set()
    for selected in solos:
        active_routes.update(_reachable(selected, adjacency))
        active_routes.update(_reachable(selected, reverse))
    # Keep designated sidechain dependencies for downstream processors without
    # opening their sources' unrelated dry branches.
    for route_id in manifest.get("sidechainRoutes", []):
        node = "route:" + route_id
        if solos and any(dest in active_routes for dest in adjacency.get(node, [])):
            active_routes.update(_reachable(node, reverse))
    for identity in manifest["instanceIds"]:
        strip = mixer.strips.get(identity, MixerStrip())
        values[channel("strip", identity, "gain")] = linear_gain(strip.gain_db)
        values[channel("strip", identity, "left")] = 1.0 - max(0.0, strip.balance)
        values[channel("strip", identity, "right")] = 1.0 + min(0.0, strip.balance)
        values[channel("strip", identity, "mute")] = 0.0 if strip.mute else 1.0
    for row in manifest["routes"]:
        route = AudioRoute.model_validate(row)
        state = mixer.sends.get(route.id, MixerSend() if route.kind == "send" else MixerSend(gainDb=0))
        strip = mixer.strips.get(route.source_id, MixerStrip())
        gate = not strip.mute and (not solos or "route:" + route.id in active_routes)
        values[channel("route", route.id, "gain")] = linear_gain(state.gain_db) * float(gate)
        values[channel("route", route.id, "post")] = float(state.tap == "post")
        pan_side = manifest.get("routePans", {}).get(route.id)
        angle = (strip.balance + 1) * math.pi / 4
        values[channel("route", route.id, "pan")] = (
            (math.cos(angle) if pan_side == "left" else math.sin(angle)) if pan_side else 1.0
        )
    return values


RAMP_OPCODE = """opcode vcs_mixer_ramp, a, ki
 setksmps 1
 kTarget, iInitial xin
 kValue init iInitial
 kPrevious init iInitial
 kRemaining init 0
 if kTarget != kPrevious then
  kRemaining = 0.02
  kPrevious = kTarget
 endif
 if kRemaining > 0 then
  kValue = kValue + (kTarget - kValue) / max(1, kRemaining * kr)
  kRemaining = max(0, kRemaining - 1 / kr)
 else
  kValue = kTarget
 endif
 aValue interp kValue
 if timeinstk() == 1 then
  aValue = iInitial
 endif
 xout aValue
endop"""


def compile_mixer_bundle(
    service,
    targets,
    graph,
    mixer,
    *,
    midi_input,
    rtmidi_module,
    allow_packaged_asset_paths=False,
    performance_input_mode="midi",
):
    validate_target_channels(targets)
    resolved = ResolvedMixerGraph(targets, graph)
    manifest = resolved.manifest()
    if set(mixer.strips) - set(manifest["instanceIds"]) or set(mixer.sends) - set(manifest["routeIds"]):
        raise CompilationError(["Mixer controls reference an unknown instance or route."])
    controls = mixer_control_values(manifest, mixer)
    manifest["initialControls"] = controls
    engine = resolve_shared_engine(targets)
    emitter = service._orchestra_emitter
    quote = emitter._format_csound_string
    names = {stage: "vcs_mix_" + token(stage) for stage in resolved.order}
    header = [
        f"sr = {engine.sr}",
        f"ksmps = {engine.ksmps}",
        f"nchnls = {engine.nchnls}",
        f"0dbfs = {engine.zero_dbfs}",
        RAMP_OPCODE,
    ]
    header += [f"chnset {value:.17g}, {quote(name)}" for name, value in controls.items()]
    if performance_input_mode == "score":
        header += emitter.score_controller_header_lines()
    else:
        header += [
            "massign 0, 0",
            *[
                f"massign {t.midi_channel}, {manifest['instrumentReferences'][t.assignment_id]}"
                for t in targets
                if not t.always_on and t.midi_channel > 0
            ],
        ]
    bodies = {}
    sfloads = []
    warnings = [d.message for d in resolved.diagnostics]

    def connect(source, outlet, target, inlet):
        header.append(f"connect {quote(names[source])}, {quote(outlet)}, {quote(names[target])}, {quote(inlet)}")

    def ramp(lines, identity, kind, field, variable):
        name = channel(kind, identity, field)
        lines += [
            f"k_{variable} chnget {quote(name)}",
            f"a_{variable} vcs_mixer_ramp k_{variable}, {controls[name]:.17g}",
        ]

    def meters(lines, identity, left, right):
        for side, signal in (("L", left), ("R", right)):
            lines += [
                f"k_peak{side} max_k {signal}, k_meter, 1",
                f"k_rms{side} rms {signal}",
                f"chnset k_peak{side} / {engine.zero_dbfs}, {quote(channel('meter', identity, 'peak' + side))}",
                f"chnset k_rms{side} / {engine.zero_dbfs}, {quote(channel('meter', identity, 'rms' + side))}",
            ]

    for identity, target in resolved.by_id.items():
        stage = "patch:" + identity
        compiled = emitter.compile_instrument_lines(
            target.patch,
            graph_context=compile_graph_context(target.patch.graph, service._opcode_service),
            instrument_number=int(manifest["instrumentReferences"][identity]),
            instrument_name=names[stage],
            global_scope_key=token(identity),
            allow_packaged_asset_paths=allow_packaged_asset_paths,
            performance_input_mode=performance_input_mode,
            score_midi_channel=target.midi_channel,
            direct_output_ports=resolved.direct_ports[identity],
            performance_controllers=controller_bindings(target, identity),
        )
        bodies[stage] = compiled.instrument_lines
        header += compiled.global_header_lines
        sfloads += compiled.sfload_global_requests
        warnings += compiled.diagnostics
        lines = ["k_meter metro 15"]
        for field in ("gain", "left", "right", "mute"):
            ramp(lines, identity, "strip", field, field)
        meter_sides = {"left": [], "right": []}
        interface = target.patch.graph.audio_interface
        main_group = next((g for g in interface.groups if g.id == interface.main_output), None) if interface else None
        meter_ports = set(main_group.ports) if main_group else set(resolved.raw_ports[identity])
        mono_pan_ports = {
            r.source_port for r in resolved.routes if r.source_id == identity and r.id in resolved.route_pans
        }
        if mono_pan_ports:
            for side in ("left", "right"):
                representative = next(
                    r for r in resolved.routes if r.source_id == identity and resolved.route_pans.get(r.id) == side
                )
                ramp(lines, representative.id, "route", "pan", "meter_pan_" + side)
        outlets = []
        for raw_name, originals in resolved.raw_ports[identity].items():
            inlet = port(raw_name)
            if not any(
                r.target_id == identity and r.target_stage == "strip" and r.target_port == raw_name
                for r in resolved.routes
            ):
                for original in originals:
                    connect(stage, original, "strip:" + identity, inlet)
            var = "a_" + inlet
            lines += [f"{var} inleta {quote(inlet)}"]
            side = resolved.sides[identity].get(raw_name)
            balance = f" * a_{side}" if side else ""
            lines += [f"{var}_post = {var} * a_gain{balance}"]
            outlets += [f"outleta {quote('pre_' + inlet)}, {var}", f"outleta {quote('post_' + inlet)}, {var}_post"]
            if raw_name in meter_ports:
                if raw_name in mono_pan_ports:
                    for meter_side in ("left", "right"):
                        meter_sides[meter_side].append(var + "_post * a_mute * a_meter_pan_" + meter_side)
                else:
                    meter_sides[side or "left"].append(var + "_post * a_mute")
        for side in ("left", "right"):
            lines.append(f"a_meter_{side} = " + (" + ".join(meter_sides[side]) or "0"))
        meters(lines, identity, "a_meter_left", "a_meter_right")
        bodies["strip:" + identity] = lines + outlets
    for route in resolved.routes:
        stage = "route:" + route.id
        lines = []
        if route.source_stage == "raw":
            for original in resolved.raw_ports[route.source_id][route.source_port]:
                connect("patch:" + route.source_id, original, stage, "pre")
            lines += ['a_signal inleta "pre"']
        else:
            for tap in ("pre", "post"):
                connect("strip:" + route.source_id, tap + "_" + port(route.source_port), stage, tap)
            ramp(lines, route.id, "route", "post", "post")
            ramp(lines, route.id, "route", "pan", "pan")
            lines += [
                'a_pre inleta "pre"',
                'a_post_signal inleta "post"',
                "a_signal = a_pre * (1 - a_post) + a_post_signal * a_post * a_pan",
            ]
        ramp(lines, route.id, "route", "gain", "send")
        lines += ['a_route_output = a_signal * a_send', 'outleta "out", a_route_output']
        dest = (
            OUTPUT
            if route.target_id == OUTPUT
            else ("strip:" if route.target_stage == "strip" else "patch:") + route.target_id
        )
        inlet = port(route.target_port) if route.target_stage == "strip" else route.target_port
        connect(stage, "out", dest, inlet)
        bodies[stage] = lines
    output = ['a_left inleta "left"', 'a_right inleta "right"', "outs a_left, a_right", "k_meter metro 15"]
    meters(output, OUTPUT, "a_left", "a_right")
    bodies[OUTPUT] = output
    header += emitter.render_sfload_global_requests(sfloads)
    for stage in resolved.order:
        if not stage.startswith("patch:") or resolved.by_id[stage[6:]].always_on:
            header.append(f"alwayson {quote(names[stage])}")
    for stage in resolved.order:
        header += [
            f"; mixer stage {stage.replace(chr(10), ' ')}",
            f"instr {names[stage]}",
            *[" " + line for line in bodies[stage]],
            "endin",
            "",
        ]
    orc = "\n".join(header)
    return CompileArtifact(
        orc=orc,
        csd=service._wrap_csd(
            orc,
            midi_input,
            rtmidi_module,
            software_buffer=engine.software_buffer,
            hardware_buffer=engine.hardware_buffer,
        ),
        diagnostics=warnings,
        manifest=manifest,
    )
