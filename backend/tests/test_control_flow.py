from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path

import mido

import numpy as np
import pytest
from pydantic import ValidationError

from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.models.patch import NodeInstance, PatchDocument, PatchGraph
from backend.app.services.compiler_common import CompilationError, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService


def wire(source, source_port, target, target_port):
    return dict(from_node_id=source, from_port_id=source_port, to_node_id=target, to_port_id=target_port)


def branch_patch(kind="switch", output_format="stereo", operator="==", selector=36):
    cases = [dict(id="first", name="First", value=36 if kind == "switch" else None,
                  node_ids=["tone", "result"], result_node_id="result"),
             dict(id="default", name="Default", node_ids=["fallback"], result_node_id="fallback", silence=True)]
    channels = ["left", "right"] if output_format == "stereo" else ["left"]
    return PatchDocument(name="Branch test", graph=PatchGraph(
        nodes=[NodeInstance(id="note", opcode="notnum"),
               NodeInstance(id="branch", opcode="Switch" if kind == "switch" else "If",
                            params={"selector": selector, "lhs": selector, "rhs": 36}),
               NodeInstance(id="tone", opcode="const_a", params={"value": 0.2}),
               NodeInstance(id="result", opcode="CaseResult"),
               NodeInstance(id="fallback", opcode="CaseResult"), NodeInstance(id="out", opcode="outs")],
        connections=[wire("note", "inote", "branch", "selector" if kind == "switch" else "lhs"),
                     *[wire("tone", "aout", "result", channel) for channel in channels],
                     wire("branch", "left", "out", "left"),
                     wire("branch", channels[-1], "out", "right")],
        control_flow={"branch": dict(kind=kind, operator=operator, output_format=output_format, cases=cases)},
    ))


def compile_patch(patch, mode="score"):
    compiler = CompilerService(OpcodeService("/static/icons"))
    return compiler.compile_patch_bundle(
        [PatchInstrumentTarget(patch=patch, midi_channel=1)], midi_input="0", rtmidi_module="none",
        performance_input_mode=mode,
    )


@contextmanager
def sound(orc, score, midi_file=None):
    cs = load_ctcsound_module().Csound()
    try:
        if midi_file is not None:
            assert cs.setOption(f"-F{midi_file}") == 0
        csd = f"<CsoundSynthesizer>\n<CsOptions>\n-n -d -m0\n</CsOptions>\n<CsInstruments>\n{orc}\n</CsInstruments>\n<CsScore>\n{score}\n</CsScore>\n</CsoundSynthesizer>"
        assert cs.compileCsdText(csd) == 0
        assert cs.start() == 0
        yield cs
    finally:
        cs.cleanup()
        cs.reset()


def samples(cs, blocks=20):
    frames = []
    for _ in range(blocks):
        assert cs.performKsmps() == 0
        frames.append(cs.spout().copy().reshape(-1, 2))
    return np.concatenate(frames)


@pytest.mark.parametrize("output_format", ["mono", "stereo"])
@pytest.mark.parametrize("note,expected", [(36, 0.2), (38, 0)])
def test_switch_audio_and_default(output_format, note, expected):
    patch = branch_patch(output_format=output_format)
    with sound(compile_patch(patch).orc, f"i 1 0 1 {note} 100\nf 0 2") as cs:
        np.testing.assert_allclose(samples(cs), expected)


@pytest.mark.parametrize("operator,note,expected", [
    ("==", 36, .2), ("!=", 36, 0), ("<", 35, .2), ("<=", 36, .2), (">", 37, .2), (">=", 36, .2),
    ("==", 35, 0), ("!=", 35, .2), ("<", 36, 0), ("<=", 37, 0), (">", 36, 0), (">=", 35, 0),
])
def test_if_comparisons(operator, note, expected):
    with sound(compile_patch(branch_patch(kind="if", operator=operator)).orc, f"i 1 0 1 {note} 100\nf 0 2") as cs:
        np.testing.assert_allclose(samples(cs), expected)


def test_polyphony_and_multiple_matched_cases():
    data = branch_patch().model_dump()
    graph = data["graph"]
    graph["nodes"] += [dict(id="snare", opcode="const_a", params={"value": .3}), dict(id="snare_result", opcode="CaseResult")]
    graph["connections"] += [wire("snare", "aout", "snare_result", side) for side in ["left", "right"]]
    graph["control_flow"]["branch"]["cases"].insert(1, dict(id="snare_case", name="Snare", value=38,
        node_ids=["snare", "snare_result"], result_node_id="snare_result"))
    with sound(compile_patch(PatchDocument.model_validate(data)).orc,
               "i 1 0 1 36 100\ni 1 0 1 36 100\ni 1 0 1 38 100\ni 1 0 1 99 100\nf 0 2") as cs:
        np.testing.assert_allclose(samples(cs), .7)


def test_schema_and_roundtrip():
    patch = branch_patch()
    assert patch.schema_version == 2
    assert PatchDocument.model_validate_json(patch.model_dump_json()) == patch
    with pytest.raises(ValidationError):
        PatchDocument.model_validate({**patch.model_dump(), "schema_version": 3})


@pytest.mark.parametrize("failure", ["missing", "duplicate", "overlap", "nested", "global", "silence"])
def test_invalid_structure(failure):
    data = branch_patch().graph.model_dump()
    block = data["control_flow"]["branch"]
    if failure == "missing":
        data["control_flow"] = {}
    elif failure == "duplicate":
        block["cases"].insert(1, {**block["cases"][0], "id": "duplicate"})
    elif failure == "overlap":
        block["cases"][-1]["node_ids"].append("tone")
    elif failure == "nested":
        block["cases"][0]["node_ids"].append("branch")
    elif failure == "global":
        block["cases"][0]["node_ids"].append("out")
    else:
        block["cases"][0]["silence"] = True
    with pytest.raises(ValidationError):
        PatchGraph.model_validate(data)


@pytest.mark.parametrize("failure", ["escape", "sibling", "rate", "missing_audio", "cycle"])
def test_compile_diagnostics(failure):
    data = branch_patch().model_dump()
    graph = data["graph"]
    if failure == "escape":
        graph["connections"].append(wire("tone", "aout", "out", "left"))
    elif failure == "sibling":
        graph["connections"].append(wire("tone", "aout", "fallback", "left"))
    elif failure == "rate":
        graph["nodes"][0]["opcode"] = "const_k"
        graph["connections"][0]["from_port_id"] = "kout"
    elif failure == "missing_audio":
        graph["connections"] = [link for link in graph["connections"] if link["to_node_id"] != "result"]
    else:
        graph["nodes"].append(dict(id="root_mul", opcode="a_mul"))
        graph["connections"] += [wire("branch", "left", "root_mul", "a"), wire("root_mul", "aout", "result", "left")]
    with pytest.raises(CompilationError):
        compile_patch(PatchDocument.model_validate(data))


def test_case_result_formulas_and_shared_dependencies():
    data = branch_patch().model_dump()
    graph = data["graph"]
    graph["nodes"].append(dict(id="shared", opcode="const_a", params={"value": .1}))
    graph["connections"].append(wire("shared", "aout", "result", "left"))
    graph["ui_layout"] = {"input_formulas": {"result::left": {"expression": "in1 * 2 + in2", "inputs": [
        dict(token="in1", from_node_id="tone", from_port_id="aout"),
        dict(token="in2", from_node_id="shared", from_port_id="aout"),
    ]}}}
    with sound(compile_patch(PatchDocument.model_validate(data)).orc, "i 1 0 1 36 100\nf 0 2") as cs:
        np.testing.assert_allclose(samples(cs), np.tile([.5, .2], (640, 1)))


def test_midi_and_score_lowering():
    patch = branch_patch()
    assert " notnum" in compile_patch(patch, "midi").orc
    assert " notnum" not in compile_patch(patch).orc
    assert "elseif" not in compile_patch(patch).orc
    assert "endif" in compile_patch(patch).orc


EXAMPLES = Path(__file__).resolve().parents[2] / "examples"


def example(name="drumset"):
    return PatchDocument.model_validate_json((EXAMPLES / f"{name}.patch.json").read_text())


def routed_compile(patch, mode="score", mixer=None):
    from backend.app.models.audio import AudioGraph, AudioRoute, MixerState
    return CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        [PatchInstrumentTarget(patch=patch, midi_channel=1, assignment_id="kit")],
        audio_graph=AudioGraph(routes=[AudioRoute(id=side, sourceId="kit", sourcePort=side,
                                                 targetId="$output", targetPort=side) for side in ["left", "right"]]),
        mixer=mixer or MixerState(), midi_input="0", rtmidi_module="none", performance_input_mode=mode,
    )


@pytest.mark.parametrize("direct", [False, True])
@pytest.mark.parametrize("note,expected", [(36, [.6, .4]), (99, [0, 0])])
def test_outlet_formulas_are_materialized_after_switch_results(direct, note, expected):
    from backend.app.models.audio import AudioGraph

    patch = branch_patch()
    if direct:
        outlets = [("out", side, side) for side in ["left", "right"]]
    else:
        patch.graph.nodes = [node for node in patch.graph.nodes if node.id != "out"]
        patch.graph.nodes += [NodeInstance(id=side, opcode="outleta", params={"sname": side})
                              for side in ["left", "right"]]
        for connection in patch.graph.connections:
            if connection.to_node_id == "out":
                connection.to_node_id = connection.to_port_id
                connection.to_port_id = "asignal"
        outlets = [(side, "asignal", side) for side in ["left", "right"]]
    patch.graph.ui_layout["input_formulas"] = {
        f"{node}::{port}": {"expression": f"in1 * {gain}", "inputs": [
            dict(token="in1", from_node_id="branch", from_port_id=side),
        ]}
        for (node, port, side), gain in zip(outlets, [3, 2])
    }
    artifact = (CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        [PatchInstrumentTarget(patch=patch, midi_channel=1, assignment_id="kit")],
        audio_graph=AudioGraph(), midi_input="0", rtmidi_module="none", performance_input_mode="score",
    ) if direct else routed_compile(patch))
    ref = artifact.manifest["instrumentReferences"]["kit"]
    with sound(artifact.orc, f"i {ref} 0 1 {note} 100\nf 0 2") as cs:
        rendered = samples(cs)
        np.testing.assert_allclose(rendered, np.broadcast_to(expected, rendered.shape), atol=1e-9)


@pytest.mark.parametrize("note", [35, 36, 38, 42, 46])
def test_analog_drumkit_stereo_output_formulas(note):
    patch = example("analog_drumkit")
    for side in ["left", "right"]:
        patch.graph.ui_layout["input_formulas"][f"output_{side}::asignal"] = {
            "expression": "in1 * 3",
            "inputs": [dict(token="in1", from_node_id="kit", from_port_id=side)],
        }
    artifact = routed_compile(patch)
    ref = artifact.manifest["instrumentReferences"]["kit"]
    with sound(artifact.orc, f"i {ref} 0 .1 {note} 100\nf 0 1") as cs:
        rendered = samples(cs, 150)
        assert np.isfinite(rendered).all()
        assert (np.sqrt(np.mean(rendered ** 2, axis=0)) > .001).all()


def write_midi(path, notes, duration=.005):
    midi = mido.MidiFile(ticks_per_beat=1000)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=500000))
    for note in notes:
        track.append(mido.Message("note_on", note=note, velocity=100))
    for index, note in enumerate(notes):
        track.append(mido.Message("note_off", note=note, velocity=0, time=round(duration * 2000) if index == 0 else 0))
    track.append(mido.MetaMessage("end_of_track", time=2000))
    midi.save(path)


@pytest.mark.parametrize("note,tail", [(36,.25), (38,.15), (42,.06), (99,0)])
def test_drumset_real_midi_noteoff_retains_decay(tmp_path, note, tail):
    path = tmp_path / "short.mid"
    write_midi(path, [note])
    patch = example()
    with sound(routed_compile(patch, "midi").orc, "f 0 1", path) as cs:
        rendered = samples(cs, 750)  # 0.5 seconds at 48 kHz / ksmps 32
    assert np.isfinite(rendered).all()
    if tail:
        offset = round(tail * 48000)
        assert abs(rendered[offset:offset+480]).max() > .00001
        assert abs(rendered[21000:]).max() < 1e-10
    else:
        np.testing.assert_array_equal(rendered, 0)


def test_drumset_overlapping_notes_and_repeated_instances(tmp_path):
    patch = example()
    artifact = routed_compile(patch, "midi")
    def render(notes):
        path = tmp_path / "overlap.mid"
        write_midi(path, notes)
        with sound(artifact.orc, "f 0 1", path) as cs:
            return samples(cs, 750)
    individual = [render([note]) for note in [36,38,42]]
    combined = render([36,38,42,36,99])
    assert np.isfinite(combined).all()
    # Noise uses Csound's shared random stream; compare decay and energy, not random sample identity.
    assert np.mean(combined[:2400] ** 2) > np.mean(individual[0][:2400] ** 2)
    np.testing.assert_allclose(combined[12000:], individual[0][12000:] * 2, atol=1e-9)
    np.testing.assert_allclose(render([36,36]), individual[0] * 2, atol=1e-9)


@pytest.mark.parametrize("note", [36,38,42,99])
def test_drumset_score_and_midi_choose_equivalent_cases(tmp_path, note):
    patch = example()
    path = tmp_path / "kit.mid"
    write_midi(path, [note])
    with sound(routed_compile(patch, "midi").orc, "f 0 1", path) as cs:
        midi_audio = samples(cs, 750)
    artifact = routed_compile(patch)
    ref = artifact.manifest["instrumentReferences"]["kit"]
    with sound(artifact.orc, f"i {ref} 0 .005 {note} 100\nf 0 1") as cs:
        score_audio = samples(cs, 750)
    np.testing.assert_allclose(score_audio, midi_audio, atol=1e-9)


def test_only_selected_case_initializes_and_performs():
    from backend.app.models.opcode import OpcodeSpec
    data = branch_patch().model_dump()
    graph = data["graph"]
    catalog = OpcodeService("/static/icons")
    for index, item in enumerate(graph["control_flow"]["branch"]["cases"]):
        name = f"Probe{index}"
        catalog._opcodes[name] = OpcodeSpec(name=name, category="test", icon="", template=
            f'chnset 1, "init{index}"\nk_count{index} init 0\nk_count{index} = k_count{index} + 1\nchnset k_count{index}, "perf{index}"')
        item["silence"] = False
        item["node_ids"].append(name)
        graph["nodes"].append(dict(id=name, opcode=name))
    fallback = next(n for n in graph["nodes"] if n["id"] == "fallback")
    fallback["params"] = dict(left=0, right=0)
    artifact = CompilerService(catalog).compile_patch_bundle([PatchInstrumentTarget(patch=PatchDocument.model_validate(data), midi_channel=1)],
        midi_input="0", rtmidi_module="none", performance_input_mode="score")
    for note, selected in [(36,0), (99,1)]:
        with sound(artifact.orc, f"i 1 0 1 {note} 100\nf 0 2") as cs:
            samples(cs, 20)
            assert cs.controlChannel(f"init{selected}")[0] == 1
            assert cs.controlChannel(f"perf{selected}")[0] == 20
            assert cs.controlChannel(f"init{1-selected}")[0] == 0
            assert cs.controlChannel(f"perf{1-selected}")[0] == 0


def test_sequential_blocks_and_per_voice_processing_then_mixer():
    from backend.app.models.audio import AudioGraph, MixerState, MixerStrip
    data = branch_patch().model_dump()
    second = branch_patch(kind="if").graph.model_dump()
    graph = data["graph"]
    # Build a second block consuming the first result; each voice multiplies its selected audio.
    for node in second["nodes"]:
        node["id"] = "second_" + node["id"]
    graph["nodes"] += [n for n in second["nodes"] if n["id"] not in {"second_note", "second_out", "second_tone"}]
    graph["connections"] = [c for c in graph["connections"] if c["to_node_id"] != "out"]
    graph["connections"] += [wire("branch", side, "second_result", side) for side in ["left","right"]]
    graph["connections"] += [wire("second_branch", side, "out", side) for side in ["left","right"]]
    block = second["control_flow"]["branch"]
    for item in block["cases"]:
        item["node_ids"] = ["second_" + n for n in item["node_ids"] if n != "tone"]
        item["result_node_id"] = "second_" + item["result_node_id"]
    graph["control_flow"]["second_branch"] = block
    graph["ui_layout"] = {"input_formulas": {"second_result::left": {"expression":"in1 * 2", "inputs":[dict(token="in1", from_node_id="branch", from_port_id="left")]}}}
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        [PatchInstrumentTarget(patch=PatchDocument.model_validate(data), midi_channel=1, assignment_id="kit")],
        audio_graph=AudioGraph(), mixer=MixerState(strips={"kit": MixerStrip(gainDb=-6.020599913279624)}),
        midi_input="0", rtmidi_module="none", performance_input_mode="score")
    ref = artifact.manifest["instrumentReferences"]["kit"]
    with sound(artifact.orc, f"i {ref} 0 .5 36 100\ni {ref} 0 .5 36 100\nf 0 1") as cs:
        np.testing.assert_allclose(samples(cs)[-1], [.4,.2], atol=1e-9)


def test_branch_api_persistence_copy_and_bundles(tmp_path):
    from backend.tests.api_test_support import _client
    patch = branch_patch().model_dump(mode="json")
    patch["graph"]["ui_layout"]["control_flow_case_sizes"] = {"branch": {"first": {"width": 1400, "height": 900}}}
    with _client(tmp_path) as client:
        saved = client.post("/api/patches", json=patch)
        assert saved.status_code == 201, saved.text
        saved = saved.json()
        assert saved["schema_version"] == 2
        assert client.get(f"/api/patches/{saved['id']}").json()["graph"] == saved["graph"]
        copied = client.post("/api/patches", json={**saved,"name":"Copy"}).json()
        assert copied["id"] != saved["id"] and copied["graph"] == saved["graph"]
        state = {"state":{"version":1,"currentPatch":saved,"instrumentTabs":[{"patch":copied}]}}
        assert client.put("/api/app-state", json=state).status_code == 200
        assert client.get("/api/app-state").json()["state"] == state["state"]
        bundle = {**saved, "sourcePatchId":saved["id"]}
        packed = client.post("/api/bundles/export/patch", json=bundle)
        assert packed.status_code == 200, packed.text
        expanded = client.post("/api/bundles/import/expand", content=packed.content, headers={"X-File-Name":"kit.orch.instrument.json", "Content-Type":"application/json"})
        assert expanded.status_code == 200, expanded.text
        assert expanded.json()["graph"] == saved["graph"]
        cleared = client.put(f"/api/patches/{saved['id']}", json={"graph":{"nodes":[],"connections":[]},"schema_version":1})
        assert cleared.status_code == 200 and cleared.json()["schema_version"] == 2
        assert client.post("/api/patches", json={**patch,"schema_version":3}).status_code == 422


@pytest.mark.parametrize("velocity", [30,110])
def test_velocity_if_example_is_playable(velocity):
    patch = example("velocity_if")
    with sound(compile_patch(patch).orc, f"i 1 0 .005 60 {velocity}\nf 0 1") as cs:
        rendered = samples(cs, 600)
    assert np.isfinite(rendered).all()
    assert abs(rendered[480:4800]).max() > .01
    assert abs(rendered[-1000:]).max() == 0
    # Sine at low velocity, additional harmonics for the selected saw case.
    spectrum = abs(np.fft.rfft(rendered[480:4800,0]))
    harmonic = spectrum[round(440*4320/48000)]
    fundamental = spectrum[round(220*4320/48000)]
    assert (harmonic > fundamental * .1) == (velocity == 110)


def test_gen_resource_is_local_and_all_cases_are_validated():
    data = branch_patch().model_dump()
    graph = data["graph"]
    graph["nodes"].append(dict(id="table",opcode="GEN"))
    graph["control_flow"]["branch"]["cases"][0]["node_ids"].append("table")
    graph["ui_layout"] = {"gen_nodes":{"table":dict(mode="ftgen",tableNumber=0,startTime=0,tableSize=1024,routineNumber=10,normalize=True,harmonicAmplitudes=[1])}}
    orc = compile_patch(PatchDocument.model_validate(data)).orc
    assert orc.index("if (") < orc.index("ftgen") < orc.index("else")
    with sound(orc,"i 1 0 .5 36 100\nf 0 1") as cs:
        np.testing.assert_allclose(samples(cs),.2)
    graph["ui_layout"]["gen_nodes"]["table"]["tableSize"] = 2**31
    with pytest.raises((ValidationError, CompilationError)):
        compile_patch(PatchDocument.model_validate(data))


@pytest.mark.parametrize("opcode", ["outs","inleta","outleta","sfload","maxalloc"])
def test_root_only_nodes_rejected_in_cases(opcode):
    data = branch_patch().model_dump()
    data["graph"]["nodes"].append(dict(id="forbidden",opcode=opcode))
    data["graph"]["control_flow"]["branch"]["cases"][0]["node_ids"].append("forbidden")
    with pytest.raises(ValidationError,match="must remain in the main graph"):
        PatchDocument.model_validate(data)


def test_silence_does_not_ignore_formulas():
    data=branch_patch().model_dump()
    data["graph"]["ui_layout"]={"input_formulas":{"fallback::left":{"expression":"1","inputs":[]}}}
    with pytest.raises(CompilationError) as error:
        compile_patch(PatchDocument.model_validate(data))
    assert any("cannot have parameters or formulas" in message for message in error.value.diagnostics)


@pytest.mark.parametrize("event_source", ["score", "midiFile"])
def test_drumset_performance_bundle_and_exported_csd_execute(tmp_path, event_source):
    from io import BytesIO
    import re
    import zipfile
    from backend.tests.api_test_support import _client
    from backend.tests.test_api import _performance_csd_export_payload

    payload = _performance_csd_export_payload()
    definition = {**example().model_dump(mode="json"), "sourcePatchId":"patch-1"}
    definition["graph"]["ui_layout"]["control_flow_case_sizes"] = {"kit": {"kick": {"width": 1800, "height": 1200}}}
    payload["performanceExport"]["patch_definitions"] = [definition]
    config = payload["performanceExport"]["performance"]["config"]
    config["instruments"][0]["id"] = "kit"
    config["audioGraph"] = {"routes":[dict(id=side,sourceId="kit",sourcePort=side,targetId="$output",targetPort=side) for side in ["left","right"]]}
    track = payload["sequencerConfig"]["tracks"][0]
    track["gate_ratio"] = .02
    track["pads"][0]["steps"][0]["note"] = [36,38,42]
    payload["eventSource"] = event_source
    with _client(tmp_path) as client:
        exported = client.post("/api/bundles/export/performance",json=payload["performanceExport"])
        assert exported.status_code == 200, exported.text
        imported = client.post("/api/bundles/import/expand",content=exported.content,
            headers={"X-File-Name":"kit.orch.json","Content-Type":"application/json"})
        assert imported.status_code == 200, imported.text
        imported_definition = imported.json()["patch_definitions"][0]
        assert imported_definition["schema_version"] == 2
        assert imported_definition["graph"] == definition["graph"]
        response = client.post("/api/bundles/export/performance-csd",json=payload)
        assert response.status_code == 200, response.text
    with zipfile.ZipFile(BytesIO(response.content)) as archive:
        csd = archive.read("Offline_Export/Offline_Export.csd").decode()
        midi = None
        if event_source == "midiFile":
            midi = tmp_path / "offline.mid"
            midi.write_bytes(archive.read("Offline_Export/Offline_Export.mid"))
    orc = re.search(r"<CsInstruments>(.*?)</CsInstruments>",csd,re.S).group(1)
    score = re.search(r"<CsScore>(.*?)</CsScore>",csd,re.S).group(1)
    assert "elseif" in orc and "xtratim" in orc
    with sound(orc,score,midi) as cs:
        rendered=samples(cs,24000)  # offline export uses ksmps=1
    assert np.isfinite(rendered).all()
    assert abs(rendered[240:2400]).max() > .01
    assert abs(rendered[12000:12480]).max() > .00001


@pytest.mark.parametrize("mode", ["score", "midi"])
def test_branch_presentation_sizes_leave_drumset_compilation_unchanged(mode):
    original = example()
    resized = original.model_copy(deep=True)
    resized.graph.ui_layout["control_flow_case_sizes"] = {
        "kit": {"kick": {"width": 1800, "height": 1200}, "default": {"width": 500, "height": 600}}
    }
    for node in resized.graph.nodes:
        node.position.x += 250
        node.position.y += 300
    assert compile_patch(resized, mode) == compile_patch(original, mode)
