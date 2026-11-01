"""Native sample equality and conservative fallbacks for lossless score packing."""
import re

import numpy as np
import pytest

from backend.app.models.session import SessionSequencerTimingConfig
from backend.app.services.compiler_common import CompilationProfile, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.performance_export_compaction import compact_score_macros, controller_note_filters
from backend.app.services.performance_export_curves import curve_orchestra_lines
from backend.app.services.compiler_orchestra import OrchestraEmitter
from backend.app.services.performance_export_service import CapturedMidiEvent, PerformanceExportService
from backend.tests.csound_test_support import load_patch_fixture
from backend.tests.test_control_flow import sound


def expand_score_macros(lines):
    definitions = {}
    result = []
    for line in lines:
        match = re.fullmatch(r"#define (VCS\d+) # (.*) #", line)
        if match:
            definitions[match[1]] = match[2]
        else:
            result.append(re.sub(r"\$(VCS\d+)", lambda m: definitions[m[1]], line))
    return result


def render(orc, lines):
    with sound(orc, "\n".join(lines)) as cs:
        samples = []
        while cs.performKsmps() == 0:
            samples.append(cs.spout().copy())
        return np.array(samples)


@pytest.mark.parametrize("case", ["direct", "formula_only", "root", "selector_formula", "selector_constant",
                                 "if", "default", "shared", "local", "unused"])
def test_controller_note_filters_are_conservative(case):
    graph = load_patch_fixture("branch_controller").graph
    if case == "formula_only":
        graph.connections = [c for c in graph.connections if c.from_node_id != "amount"]
    elif case == "root":
        graph.ui_layout["input_formulas"]["out::left"] = graph.ui_layout["input_formulas"]["tone::ksig"]
    elif case == "selector_formula":
        graph.ui_layout["input_formulas"]["branch::selector"] = {
            "expression": "pitch + 2", "inputs": [dict(token="pitch", from_node_id="note", from_port_id="inote")]}
    elif case == "selector_constant":
        graph.connections = [c for c in graph.connections if c.to_node_id != "branch"]
    elif case == "if":
        graph.control_flow["branch"].kind = "if"
    elif case in {"default", "shared"}:
        formula = graph.ui_layout["input_formulas"]["tone::ksig"]
        graph.ui_layout["input_formulas"]["fallback::left"] = formula
        if case == "default":
            graph.ui_layout["input_formulas"].pop("tone::ksig")
            graph.connections = [c for c in graph.connections if c.from_node_id != "amount"]
    elif case == "local":
        graph.control_flow["branch"].cases[0].node_ids.append("amount")
    elif case == "unused":
        graph.ui_layout["input_formulas"] = {}
        graph.connections = [c for c in graph.connections if c.from_node_id != "amount"]
    expected = {"direct": {36}, "formula_only": {36}, "local": {36}, "unused": set(),
                "shared": set(range(128)), "default": set(range(128)) - {36}}
    actual = controller_note_filters(graph)["amount"]
    assert actual == (frozenset(expected[case]) if case in expected else None)


@pytest.mark.parametrize("offset", [-1, 0, 1])
@pytest.mark.parametrize("default_branch", [False, True])
def test_branch_compaction_and_value_reuse_render_identical_samples(monkeypatch, offset, default_branch):
    patch = load_patch_fixture("branch_controller")
    if default_branch:
        first, default = patch.graph.control_flow["branch"].cases
        first.node_ids.remove("tone")
        default.node_ids.append("tone")
        first.silence, default.silence = True, False
        for connection in patch.graph.connections:
            if connection.to_node_id == "result":
                connection.to_node_id = "fallback"
    target = PatchInstrumentTarget(patch, 1, assignment_id="kit", performance_controller_midi_ccs={"amount": 21})
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        [target], "0", "none", performance_input_mode="score", profile=CompilationProfile.OFFLINE)
    messages = [(i / 1000, [0xB0, 21, [31, 63, 94][i % 3]]) for i in range(300)]
    # Only three relevant attacks, surrounded by many unrelated notes. Keep a
    # sustained voice across automation and test setters on both sides of onset.
    for i in range(10, 280, 10):
        pitch = 36 if (i in {30, 150, 240}) != default_branch else 42
        time = i / 1000 + offset / 48000
        messages.extend([(time, [0x90, pitch, 100]), (time + .025, [0x80, pitch, 0])])
    messages.extend([(0, [0xB0, 21, 10]), (.15, [0xB0, 21, 20]), (.15, [0xB0, 21, 30]), (.3, [0xB0, 21, 0])])
    events = [CapturedMidiEvent(time, bytes(message), sequence)
              for sequence, (time, message) in enumerate(messages)]
    service = PerformanceExportService(None, None)
    args = dict(events=events, targets=[target], manifest=artifact.manifest, orchestra=artifact.orc,
                duration_seconds=.32, timing=SessionSequencerTimingConfig())
    compact, _ = service._build_score_lines(**args)
    monkeypatch.setattr("backend.app.services.performance_export_service.controller_note_filters", lambda _: {})
    original, _ = service._build_score_lines(**args)
    assert sum(line.startswith("i 1 ") for line in compact) < sum(line.startswith("i 1 ") for line in original) / 2
    packed = compact_score_macros(compact)
    assert any(line.startswith("#define") for line in packed)
    assert expand_score_macros(packed) == compact
    before, after = render(artifact.orc, original), render(artifact.orc, packed)
    assert before.max() > 0
    np.testing.assert_array_equal(after, before)


def test_score_macros_reuse_curves_losslessly_and_keep_order_comments_and_short_values():
    lines = ["; Keep this comment", "i 2 0 .4", "i 1 0 .0000208333 0 0"]
    for repeat in range(4):
        time = repeat / 10
        lines.extend([f"i 8998 {time:.10f} 0.1000000000 10 0 0.0500000000 100 0.0500000000 0",
                      f"i 9000 {time:.10f} .000021 10 50"])
    lines.append("f 0 .4")
    packed = compact_score_macros(lines)
    assert len("\n".join(packed)) < len("\n".join(lines))
    assert sum(line.startswith("#define") for line in packed) == 1
    assert expand_score_macros(packed) == lines
    orc = "\n".join(["sr=48000", "ksmps=1", "nchnls=2", "0dbfs=1", "instr 1", "endin",
        *OrchestraEmitter.score_controller_header_lines(), *curve_orchestra_lines(),
        "instr 2", "a1 upsamp gk_vcs_score_cc[10]", "outs a1, a1", "endin"])
    before, after = render(orc, lines), render(orc, packed)
    assert before.max() > 50
    np.testing.assert_array_equal(after, before)


def test_small_or_unique_scores_stay_inline():
    lines = ["i 1 0 .000021 0 1", "i 1 .1 .000021 0 1", "i 8999 0 1 10 0 1 127", "; Comment", "f 0 2"]
    assert compact_score_macros(lines) == lines


@pytest.mark.parametrize("metadata", [None, [], {"tone::ksig": {"inputs": None}}, {"tone::ksig": {"inputs": [None]}}])
def test_unknown_formula_metadata_keeps_all_note_observations(metadata):
    graph = load_patch_fixture("branch_controller").graph
    graph.ui_layout["input_formulas"] = metadata
    assert controller_note_filters(graph).get("amount") is None
