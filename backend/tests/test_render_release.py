"""Graph selection and historical report validation, never performance evidence."""
from dataclasses import asdict, replace
import json

import pytest

from backend.app.core.config import Settings
from backend.app.engine.render_release import MAX_CATALOG_BYTES, RenderRelease, ReleaseCatalog
from backend.app.models.render_plan import RenderCostProfile, RenderStageCost
from backend.app.models.render_protocol import RendererPolicy
from backend.tests.test_render_qualification import evidence

BROWSER = {"playbackMode": "auto", "maxBlocksPerRequest": 96}


def catalog_data():
    record = replace(evidence(), runtime="a" * 64, artifact_hash="b" * 64, plan_hash="c" * 64,
                     single_settings=json.dumps(BROWSER), parallel_settings=json.dumps(BROWSER))
    costs = RenderCostProfile("fabricated selection test", (RenderStageCost("stage", 100.),), 1., .001)
    return {"version": 1, "policy": RendererPolicy(mode="auto", max_workers=3).model_dump(mode="json"),
            "profiles": [{"input_hash": digit * 64, "costs": asdict(costs),
                          "evidence": asdict(replace(record, workload=f"heavy-{digit}"))} for digit in ("1", "2")]}


def test_opt_in_uses_graph_without_catalog_costs_or_browser_setting_gate():
    release = RenderRelease(Settings())
    for settings in (None, BROWSER, {"playbackMode": "listening", "maxBlocksPerRequest": 74}):
        options = release.options(settings)
        assert options.blocked_reason is None and options.graph_selection
        assert options.policy.mode == "auto" and not options.allow_unqualified
        assert options.qualifications == () and options.costs is None
        assert options.policy.coordination_frames == 128


@pytest.mark.parametrize("frames", [1, 32, 128, 256, 1024])
def test_coordination_setting_reaches_policy_without_changing_single_default(monkeypatch, frames):
    monkeypatch.setenv("VISUALCSOUND_PARALLEL_RENDER_BATCH_FRAMES", str(frames))
    assert RenderRelease(Settings()).options().policy.coordination_frames == frames
    assert RendererPolicy().mode == "single"


@pytest.mark.parametrize("frames", ["0", "1025", "128.5", "invalid"])
def test_coordination_setting_is_bounded(monkeypatch, frames):
    monkeypatch.setenv("VISUALCSOUND_PARALLEL_RENDER_BATCH_FRAMES", frames)
    with pytest.raises(ValueError):
        Settings()


def test_operator_rollback_blocks_graph_selection():
    release = RenderRelease(Settings(parallel_playback_enabled=False))
    assert release.options(BROWSER).blocked_reason == "parallel_disabled"
    assert not release.options(BROWSER).enabled()


@pytest.mark.parametrize("change", ["single_workload", "duplicate", "force_parallel", "failed_gate", "extra_override", "nonfinite", "bad_digest"])
def test_offline_report_validation_still_rejects_invalid_evidence(change):
    data = catalog_data()
    if change == "single_workload":
        data["profiles"].pop()
    elif change == "duplicate":
        data["profiles"][1] = data["profiles"][0]
    elif change == "force_parallel":
        data["policy"]["mode"] = "parallel"
    elif change == "failed_gate":
        data["profiles"][0]["evidence"]["parallel_underruns"] = 1
    elif change == "extra_override":
        data["allow_unqualified"] = True
    elif change == "nonfinite":
        data["profiles"][0]["costs"]["dispatch_microseconds"] = float("nan")
    else:
        data["profiles"][0]["evidence"]["runtime"] = "some build"
    with pytest.raises(ValueError):
        ReleaseCatalog.model_validate_json(json.dumps(data))


def test_legacy_catalog_path_is_never_read_for_playback(tmp_path):
    path = tmp_path / "release.json"
    for content in (None, b'{"version":', b" " * (MAX_CATALOG_BYTES + 1)):
        if content is not None:
            path.write_bytes(content)
        assert RenderRelease(Settings(parallel_qualification_file=path)).options(BROWSER).graph_selection
