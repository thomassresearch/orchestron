"""Explicit, unqualified T06 fixtures. Never used by normal application startup."""
from backend.app.engine.session_renderer_options import SessionRendererOptions
from backend.app.models.render_protocol import RendererPolicy
from backend.app.engine.render_capacity import MIB, RenderAdmission, RenderCapacity
from backend.tests.render_plan_support import planner_inputs, synthetic_costs


def options(mode="auto", *, qualified_opt_in=True, coordination_frames=128):
    return SessionRendererOptions(policy=RendererPolicy(mode=mode, max_workers=4, coordination_frames=coordination_frames,
        startup_timeout_seconds=10, stop_timeout_seconds=.5, render_timeout_seconds=2),
        costs=synthetic_costs, allow_unqualified=qualified_opt_in,
        admission=RenderAdmission(lambda: RenderCapacity(12., True, 4096 * MIB, 64 * MIB)))


def create_session(client, *, case="two", ksmps=32, start=True):
    targets, graph, mixer = planner_inputs(case, ksmps)
    assignments = []
    for target in targets:
        response = client.post("/api/patches", json={"name": target.patch.name,
            "always_on": target.always_on, "graph": target.patch.graph.model_dump(mode="json")})
        assert response.status_code == 201, response.text
        assignments.append({"id": target.assignment_id, "patch_id": response.json()["id"],
                            "midi_channel": target.midi_channel})
    response = client.post("/api/sessions", json={"instruments": assignments,
        "audio_graph": graph.model_dump(mode="json", by_alias=True) if graph else None,
        "mixer": mixer.model_dump(mode="json", by_alias=True) if graph else {}})
    assert response.status_code == 201, response.text
    identity = response.json()["session_id"]
    if start:
        response = client.post(f"/api/sessions/{identity}/start")
        assert response.status_code == 200, response.text
    return identity
