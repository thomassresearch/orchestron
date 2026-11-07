from dataclasses import replace
from types import SimpleNamespace

import pytest

from backend.app.engine.render_qualification import QualificationEvidence, select_qualification


def evidence():
    # Fabricated gate inputs, never shipped as registered/native evidence.
    return QualificationEvidence(runtime="build", artifact_hash="artifact", plan_hash="plan", workload="heavy-a",
        report_digest="f" * 64, single_settings="same", parallel_settings="same", effective_cpus=4.,
        single_p95_ms=10., parallel_p95_ms=8., single_p99_ms=12., parallel_p99_ms=12.,
        single_browser_seconds=1800., parallel_browser_seconds=1800., single_underruns=0, parallel_underruns=0,
        stress_single_underruns=1, stress_parallel_underruns=1, stress_single_recovery_ms=10.,
        stress_parallel_recovery_ms=10., private_memory_bytes=400_000_000, native_correctness=True, final_image=True)


@pytest.mark.parametrize("change,reason", [({"parallel_p95_ms": 8.01}, "insufficient_measured_benefit"),
    ({"parallel_p99_ms": 12.01}, "insufficient_measured_benefit"),
    ({"parallel_p95_ms": float("nan")}, "invalid_measurement"),
    ({"parallel_settings": "longer queue"}, "incomplete_qualification"),
    ({"final_image": False}, "incomplete_qualification"),
    ({"private_memory_bytes": 0}, "incomplete_qualification"),
    ({"effective_cpus": 3.9}, "incomplete_qualification"),
    ({"parallel_browser_seconds": 1799.}, "browser_soak_incomplete"),
    ({"parallel_underruns": 1}, "browser_underruns_or_recovery"),
    ({"stress_parallel_recovery_ms": 11.}, "browser_underruns_or_recovery")])
def test_qualification_requires_every_gate(change, reason):
    assert replace(evidence(), **change).rejection() == reason


def test_exact_build_artifact_plan_and_two_workloads_are_required():
    first = evidence()
    second = replace(first, workload="heavy-b", artifact_hash="second")
    match = dict(runtime="build", compilation=SimpleNamespace(artifact_hash="artifact"), plan=SimpleNamespace(plan_hash="plan"))
    assert select_qualification([first], **match) is None
    assert select_qualification([first, second], **match) == first
    for key, value in [("runtime", "new build"), ("compilation", SimpleNamespace(artifact_hash="edited")),
                       ("plan", SimpleNamespace(plan_hash="resized"))]:
        assert select_qualification([first, second], **{**match, key: value}) is None
