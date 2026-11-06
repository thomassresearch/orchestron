"""Compile-preflight, install and export Enough/Logan through the backend API.

Run after deploying the new opcode catalog: .venv/bin/python tools/altamax/install.py
Existing names are reused only when their complete authored graph matches.
"""

import argparse
import json

from build import ROOT, enough, logan
from backend.app.models.export import ExportedPatchDefinition
from backend.app.models.patch import PatchDocument
from orchestron_patch.cli.orchestron_patch_cli import ApiClient, compile_payload_preflight


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://127.0.0.1:8000/api")
    args = parser.parse_args()
    client = ApiClient(args.api_url, timeout=60)
    assert client.get("/health")["status"] == "ok"
    for opcode in ["phasor", "mirror", "linseg_a"]:
        assert client.get("/opcodes/" + opcode)["name"] == opcode
    installed = []
    for patch in [enough(), logan()]:
        payload = patch.model_dump(mode="json", by_alias=True, exclude={"id", "created_at", "updated_at"})
        matches = [p for p in client.get("/patches") if p["name"] == patch.name]
        if matches:
            if len(matches) != 1:
                raise RuntimeError(f"Ambiguous existing library name: {patch.name}")
            saved = client.get("/patches/" + matches[0]["id"])
            if PatchDocument.model_validate(saved).graph != patch.graph:
                raise RuntimeError(f"Existing {patch.name} differs; refusing to overwrite it.")
        else:
            compile_payload_preflight(client, payload)
            saved = client.post("/patches", payload)
        identity = saved["id"]
        session = client.post("/sessions", dict(instruments=[dict(id="voice", patch_id=identity, midi_channel=1)],
            audio_graph=dict(masterId="$master", routes=[
                dict(id=side, sourceId="voice", sourcePort=side, targetId="$master", targetPort=side)
                for side in ["left", "right"]])))
        sid = session["session_id"]
        try:
            compiled = client.post(f"/sessions/{sid}/compile")
            assert compiled["state"] == "compiled"
            started = client.post(f"/sessions/{sid}/start")
            assert started["state"] == "running"
            client.post(f"/sessions/{sid}/stop")
        finally:
            client.delete(f"/sessions/{sid}")
        document = PatchDocument.model_validate(saved)
        definition = ExportedPatchDefinition(sourcePatchId=identity, **document.model_dump(exclude={"id"}))
        exported = client.post("/bundles/export/patch", definition.model_dump(mode="json", by_alias=True))
        path = ROOT / "examples/instruments" / (patch.name + ".orch.instrument.json")
        path.write_text(json.dumps(exported, indent=2, ensure_ascii=False) + "\n")
        installed.append(dict(name=patch.name, id=identity, master_compile="passed", native_start="passed", export=str(path)))
    output = ROOT / "output/altamax"
    output.mkdir(parents=True, exist_ok=True)
    (output / "installed.json").write_text(json.dumps(installed, indent=2) + "\n")
    print(json.dumps(installed, indent=2))


if __name__ == "__main__":
    main()
