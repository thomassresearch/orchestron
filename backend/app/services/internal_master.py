"""Compiler-owned stereo Master. It is never stored or resolved as a library patch."""

from backend.app.models.patch import PatchDocument, PatchGraph
from backend.app.services.compiler_common import PatchInstrumentTarget

MASTER = "$master"


def internal_master_target() -> PatchInstrumentTarget:
    # Private port metadata lets Master share the normal strip/insert lowering.
    # Its body is emitted directly by compiler_mixer, never by the patch compiler.
    graph = PatchGraph.model_validate({
        "nodes": [
            {"id": "left", "opcode": "inleta", "params": {"sname": "left"}},
            {"id": "right", "opcode": "inleta", "params": {"sname": "right"}},
            {"id": "output", "opcode": "outs", "params": {}},
        ],
        "connections": [],
        "audio_interface": {
            "role": "output", "mainInput": "input", "mainOutput": "output",
            "groups": [
                {"id": "input", "name": "Stereo Input", "direction": "input", "ports": ["left", "right"]},
                {"id": "output", "name": "Audio Output", "direction": "output",
                 "ports": ["$direct.left", "$direct.right"]},
            ],
        },
    })
    return PatchInstrumentTarget(
        patch=PatchDocument(id=MASTER, name="Master", graph=graph, always_on=True, instrument_type="continuous"),
        midi_channel=0, assignment_id=MASTER, always_on=True,
    )
