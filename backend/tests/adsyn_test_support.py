"""Synthetic, independently versioned analysis data for adsyn integration tests."""
from pathlib import Path

from backend.app.models.patch import Connection, NodeInstance, PatchDocument, PatchGraph
from backend.app.services.compiler_service import CompilerService
from backend.app.services.gen_asset_service import GenAssetService
from backend.app.services.opcode_service import OpcodeService

ANALYSIS_FILE = Path(__file__).parent / "fixtures/analysis/decaying-sine.het"


def adsyn_patch(asset=None, **params):
    if asset is None:
        asset = dict(asset_id="analysis-test", original_name=ANALYSIS_FILE.name,
                     stored_name=ANALYSIS_FILE.name, content_type="application/octet-stream",
                     size_bytes=ANALYSIS_FILE.stat().st_size)
    return PatchDocument(name="Additive analysis test", graph=PatchGraph(
        nodes=[NodeInstance(id="tone", opcode="adsyn", params=params), NodeInstance(id="out", opcode="outs")],
        connections=[Connection(from_node_id="tone", from_port_id="ares", to_node_id="out", to_port_id=side)
                     for side in ("left", "right")],
        ui_layout={"adsyn_nodes": {"tone": {"sampleAsset": asset}}},
    ))


def adsyn_compiler(directory):
    return CompilerService(OpcodeService("/static/icons"), GenAssetService(directory))
