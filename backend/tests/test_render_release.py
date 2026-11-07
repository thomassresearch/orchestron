"""Fabricated qualification records test selection only, never performance evidence."""
from dataclasses import asdict, replace
import json
from types import SimpleNamespace

import pytest

from backend.app.core.config import Settings
from backend.app.engine.render_release import MAX_CATALOG_BYTES, RenderRelease
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


def release(tmp_path, data=None):
    path = tmp_path / "release.json"
    path.write_text(json.dumps(catalog_data() if data is None else data))
    return RenderRelease(Settings(parallel_qualification_file=path))


def test_default_has_no_override_or_qualification():
    options = RenderRelease(Settings()).options(BROWSER)
    assert options.blocked_reason == "parallel_not_qualified"
    assert options.policy.mode == "auto" and not options.allow_unqualified
    assert options.qualifications == ()


def test_catalog_filters_exact_build_settings_and_graph_without_synthetic_costs(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.app.engine.render_release.runtime_fingerprint", lambda: "a" * 64)
    installed = release(tmp_path)
    options = installed.options(dict(reversed(list(BROWSER.items()))))
    assert options.blocked_reason is None and len(options.qualifications) == 2
    assert options.costs(SimpleNamespace(input_hash="1" * 64)).provenance == "fabricated selection test"
    assert options.costs(SimpleNamespace(input_hash="3" * 64)) is None
    assert installed.options({**BROWSER, "maxBlocksPerRequest": 97}).blocked_reason == "browser_settings_not_qualified"
    monkeypatch.setattr("backend.app.engine.render_release.runtime_fingerprint", lambda: "d" * 64)
    assert installed.options(BROWSER).blocked_reason == "qualification_build_mismatch"


def test_operator_rollback_precedes_catalog_and_never_reads_native(tmp_path, monkeypatch):
    def unexpected():
        raise AssertionError("Rollback must not inspect native runtime")
    monkeypatch.setattr("backend.app.engine.render_release.runtime_fingerprint", unexpected)
    installed = release(tmp_path)
    installed.settings.parallel_playback_enabled = False
    options = installed.options(BROWSER)
    assert options.blocked_reason == "parallel_disabled"
    assert not options.qualifications and not options.allow_unqualified


@pytest.mark.parametrize("change", ["single_workload", "duplicate", "force_parallel", "failed_gate", "extra_override", "nonfinite", "bad_digest"])
def test_invalid_catalog_falls_back(tmp_path, change):
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
    assert release(tmp_path, data).options(BROWSER).blocked_reason == "qualification_catalog_invalid"


def test_missing_truncated_and_oversized_catalogs_fall_back(tmp_path):
    path = tmp_path / "release.json"
    for content in (None, b'{"version":', b" " * (MAX_CATALOG_BYTES + 1)):
        if content is not None:
            path.write_bytes(content)
        assert RenderRelease(Settings(parallel_qualification_file=path)).options(BROWSER).blocked_reason == "qualification_catalog_invalid"
