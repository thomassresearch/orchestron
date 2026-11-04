"""Executable musical, sparse-plan and sounding-event acceptance contracts."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.app.models.clip_transposition import (
    OffsetPlan,
    MODE_INTERVALS,
    ROOT_PITCH_CLASS,
    effective_plan,
    transpose_pitch,
)
from backend.app.models.clip_arrangement import ClipSchedule, PreparedClipSchedule
from backend.tests.test_sequencer_note_timing import make_runtime, advance, notes

VECTORS = json.loads((Path(__file__).parent / "fixtures/clip_transposition/pitches.json").read_text())
Q = 20160


def plan(d=0, c=0, entries=()):
    return dict(
        base=dict(diatonicSteps=d, chromaticSemitones=c),
        repetitions=[dict(index=i, offset=dict(diatonicSteps=x, chromaticSemitones=y)) for i, x, y in entries],
    )


def wire(plans=None, refs=None, length=4 * Q, offset=0, base=0):
    return dict(
        version=2,
        end=length,
        transpose_plans=plans or [plan(entries=[(1, 1, 0), (2, 0, 12)])],
        clips=[
            dict(
                id="clip",
                start=0,
                length=length,
                offset=offset,
                mode="loop",
                repeat_index_base=base,
                content=[dict(pad=0, length=Q, transpose_refs=[0] if refs is None else refs)],
            )
        ],
    )


@pytest.mark.parametrize("v", VECTORS, ids=lambda v: v["id"])
def test_musical_vectors(v):
    pair = v["offset"]["diatonicSteps"], v["offset"]["chromaticSemitones"]
    assert [transpose_pitch(p, v["root"], v["mode"], pair) for p in v["pitches"]] == v["expected"]


def test_identity_and_octaves_every_mode_root_and_pitch():
    for mode in MODE_INTERVALS:
        for root in ROOT_PITCH_CLASS:
            for p in range(128):
                assert transpose_pitch(p, root, mode, (0, 0)) == p
                assert transpose_pitch(p, root, mode, (7, 0)) == (p + 12 if p <= 115 else None)
                assert transpose_pitch(p, root, mode, (-7, 0)) == (p - 12 if p >= 12 else None)


def test_exact_replacements_not_hold_last_or_cumulative():
    base, entries = effective_plan(
        [OffsetPlan.model_validate(plan(2, 0, [(0, 0, 0), (1, 2, 0)])), OffsetPlan.model_validate(plan(0, 12))]
    )
    assert base == (2, 12)
    assert entries == {0: (0, 12)}
    assert entries.get(2, base) == (2, 12)


@pytest.mark.parametrize("value", [True, 1.5, float("nan"), 128, -128, "1"])
def test_strict_amounts(value):
    with pytest.raises(ValidationError):
        OffsetPlan.model_validate(plan(value))


def test_unsorted_duplicate_entries_and_v1_references_rejected():
    for entries in [[(1, 0, 0), (1, 1, 0)], [(2, 0, 0), (1, 0, 0)], [(-1, 0, 0)]]:
        with pytest.raises(ValidationError):
            OffsetPlan.model_validate(plan(entries=entries))
    for change in [dict(version=1), dict(transpose_plans=[]), dict(version=3)]:
        with pytest.raises(ValidationError):
            ClipSchedule.model_validate({**wire(), **change})


def test_lazy_logical_indices_crop_seek_repeat_base_and_lane_cycle():
    prepared = PreparedClipSchedule(ClipSchedule.model_validate(wire(offset=3 * Q // 2, base=3, length=Q * 900000)))
    assert len(prepared.content_ends[0]) == 1
    assert len(prepared.span_plans[0][0][1]) == 2
    assert prepared.locate(0).logical_pass == 4
    assert prepared.locate(Q // 2).logical_pass == 5
    assert prepared.locate(800000 * Q).logical_pass == 800004
    cyclic = PreparedClipSchedule(ClipSchedule.model_validate({**wire(), "cycle_ticks": 4 * Q}))
    assert cyclic.locate(Q).transpose == cyclic.locate(5 * Q).transpose == (1, 0)


def test_same_pad_repeat_uses_different_pitches_and_balanced_releases():
    r, c, config = make_runtime(
        [60, 64, 67, None],
        pads=[dict(pad_index=0, length_beats=1, steps=[60, 64, 67, None], scale_root="C", mode="ionian")],
        pad_loop_enabled=True,
        clip_schedule=wire(),
    )
    config.playback_end_step = 32
    r.configure(config)
    advance(r, c, 14000)
    ons = [m[1] for _, m in notes(c) if m[0] == 144]
    offs = [m[1] for _, m in notes(c) if m[0] == 128]
    assert ons == [60, 64, 67, 62, 65, 69, 72, 76, 79, 60, 64, 67]
    assert offs == ons
    assert config.tracks[0].pads[0].steps == [60, 64, 67, None]


def test_range_omission_has_no_voice_or_release():
    r, c, _ = make_runtime([127, None, None, None], pad_loop_enabled=True, clip_schedule=wire([plan(c=1)]))
    advance(r, c, 14000)
    assert notes(c) == []


def test_strum_omission_preserves_original_delay():
    from backend.app.services.clip_transposition import variant

    r, _, _ = make_runtime([dict(note=[0, 60, 64], strum_direction="up", strum_spread_percent=100), None, None, None])
    original = r._config.tracks["lead"].pads[0]
    shifted = variant(original, (0, -1))
    assert shifted.strum_attacks[0] == tuple((delay, p - 1) for delay, p in original.strum_attacks[0] if p > 0)
    assert shifted.strum_attacks[0][0][0] > 0
    assert variant(original, (0, -1)) is shifted


def test_score_collision_indexes_rebuilt_from_untruncated_authored_notes():
    from backend.app.services.score_sequencer import prepare_pad
    from backend.app.services.clip_transposition import variant

    original = prepare_pad((("a", 63, 100, 0, Q), ("b", 64, 90, Q // 2, Q)), 4, 4, 4, 4, 1, 1, "C", "ionian")
    shifted = variant(original, (1, 0))
    assert [(n.id, n.pitch, n.start, n.end) for n in shifted.score_notes] == [
        ("a", 65, 0, Q // 2),
        ("b", 65, Q // 2, 3 * Q // 2),
    ]
    assert shifted.score_by_id["a"].end == Q
    assert len(shifted.score_by_pitch) == 1
    assert original.score_by_id["a"].pitch == 63


def test_live_transpose_latches_current_occurrence_and_seek_resets():
    from backend.app.models.session import SessionSequencerConfigRequest

    r, c, config = make_runtime([60, 62, 64, None], pad_loop_enabled=True, clip_schedule=wire([plan()]))
    advance(r, c, 500)
    payload = config.model_dump()
    payload["tracks"][0]["clip_schedule"] = wire([plan(c=12)])
    r.configure(SessionSequencerConfigRequest.model_validate(payload))
    advance(r, c, 4500)
    assert [m[1] for _, m in notes(c) if m[0] == 144] == [60, 62, 64, 72, 74]
    # Seeking into the same occurrence must discard its previous latch.
    with r._lock:
        r._seek_absolute_subunit_locked(0)
    advance(r, c, 4700)
    assert [m[1] for _, m in notes(c) if m[0] == 144][-1] == 72


def test_live_musical_edit_uses_new_notes_with_old_pair_until_boundary():
    from backend.app.models.session import SessionSequencerConfigRequest

    r, c, config = make_runtime([60, 62, 64, None], pad_loop_enabled=True, clip_schedule=wire([plan(c=12)]))
    advance(r, c, 500)
    payload = config.model_dump()
    payload["tracks"][0]["pads"][0]["steps"][1] = 65
    payload["tracks"][0]["clip_schedule"] = wire([plan(c=24)])
    r.configure(SessionSequencerConfigRequest.model_validate(payload))
    advance(r, c, 4500)
    assert [m[1] for _, m in notes(c) if m[0] == 144] == [72, 77, 76, 84, 89]


def test_clip_audition_exact_rest_duration_and_selected_pair_then_restore():
    from backend.app.models.session import SessionAuditionRequest, SessionSequencerConfigRequest

    context = wire([plan(c=12)], length=Q + 1)
    context["cycle_ticks"] = Q + 1
    context["clips"][0].update(
        mode="once", content=[dict(pad=0, length=Q, transpose_refs=[0]), dict(pad=None, length=1)]
    )
    r, c, config = make_runtime(
        [60, None, None, None], pad_loop_enabled=True, clip_schedule=wire([plan(c=24)]), audition_schedule=context
    )
    r.stop()
    r.audition(
        SessionAuditionRequest(
            action="workspace_start", track_ids=["lead"], sequence=[0], clip_context=True, gesture_id="test", revision=1
        )
    )
    advance(r, c, 7000)
    assert [m[1] for _, m in notes(c) if m[0] == 144] == [72, 72, 72]
    assert r._config.tracks["lead"].clip_schedule.schedule.cycle_ticks == Q + 1
    r.audition(SessionAuditionRequest(action="workspace_end", track_ids=["lead"], gesture_id="test", revision=2))
    assert (
        r._config.tracks["lead"].clip_schedule.schedule
        == SessionSequencerConfigRequest.model_validate(config.model_dump()).tracks[0].clip_schedule
    )


def test_authored_fixture_and_validation_of_unused_fields():
    from copy import deepcopy
    from backend.app.models.clip_validation import validate_authored_clips

    config = json.loads((Path(__file__).parent / "fixtures/clip_transposition/performance.json").read_text())
    assert validate_authored_clips(config) == config
    changes = [
        lambda lane: lane["transposeProfiles"][0]["plan"]["base"].update(diatonicSteps=True),
        lambda lane: lane["definitions"][0].update(transposeProfileId="missing"),
        lambda lane: lane["clips"][0]["transposePlacements"][0].update(path=["bad"]),
        lambda lane: lane["transposeProfiles"].append(dict(id="unused", revision=0, plan=plan(128))),
        lambda lane: lane["clips"][0].update(repeatIndexBase=40320000000),
    ]
    for change in changes:
        bad = deepcopy(config)
        change(bad["sequencer"]["clipArrangement"]["lanes"][0])
        with pytest.raises(ValueError):
            validate_authored_clips(bad)


def test_arpeggiator_repeat_mapping_after_quantizer_and_bypass():
    from backend.tests.test_arpeggiator_patterns import Playback

    settings = dict(
        pad_loop_sequence=[],
        clip_schedule=wire([plan(c=1, entries=[(1, 0, 12)])]),
        pads=[dict(length_beats=1, pattern="up", rate="1/4", scale_root="C", mode="ionian", scale_mode="custom")],
    )
    playback = Playback(**settings)
    playback.note((60,))
    playback.advance(50000)
    assert playback.attacks[:3] == [(61, 0), (72, 24000), (61, 48000)]
    bypass = Playback(processing_mode="bypass", **settings)
    bypass.note((60,))
    bypass.advance(100)
    assert bypass.attacks == [(60, 0)]


def test_arpeggiator_selected_context_audition_uses_prepared_pitch_map():
    from backend.tests.test_arpeggiator_patterns import Playback
    from backend.app.models.session import SessionAuditionRequest

    context = wire([plan(c=12)], length=Q)
    context["cycle_ticks"] = Q
    context["clips"][0]["mode"] = "once"
    playback = Playback(
        pad_loop_sequence=[],
        clip_schedule=wire([plan(c=1)]),
        audition_schedule=context,
        pads=[dict(length_beats=1, pattern="up", rate="1/4")],
    )
    playback.router.set_transport(beat=0, running=False, sample=0)
    playback.advance(1)  # Apply the queued transport command before the audition.
    playback.router.audition(
        SessionAuditionRequest(
            action="workspace_start",
            arpeggiator_id="arp",
            sequence=[0],
            clip_context=True,
            gesture_id="clip",
            revision=1,
        ),
        transport_running=False,
    )
    playback.note((60,))
    playback.advance(50000)
    assert playback.attacks[:3] == [(72, 1), (72, 24001), (72, 48001)]


@pytest.mark.parametrize("strum", [False, True])
def test_anticipated_repeat_latches_future_transposition(strum):
    from backend.app.models.session import SessionSequencerConfigRequest

    step = dict(note=[60, 64] if strum else 60, timing_offset_percent=-25)
    if strum:
        step.update(strum_direction="up", strum_spread_percent=50)
    r, c, config = make_runtime(
        [step, None, None, None], pad_loop_enabled=True, clip_schedule=wire([plan(entries=[(1, 0, 12)])])
    )
    advance(r, c, 3200)
    assert (3150, (144, 72, 100)) in notes(c)
    payload = config.model_dump()
    payload["tracks"][0]["clip_schedule"] = wire([plan(entries=[(1, 0, 24)])])
    r.configure(SessionSequencerConfigRequest.model_validate(payload))
    advance(r, c, 5000)
    attacks = [(at, m[1]) for at, m in notes(c) if m[0] == 144]
    assert attacks == ([(0, 60), (420, 64), (3150, 72), (3570, 76)] if strum else [(0, 60), (3150, 72)])
    assert [(at, m[1]) for at, m in notes(c) if m[0] == 128] == (
        [(840, 60), (1260, 64), (3990, 72), (4410, 76)] if strum else [(840, 60), (3990, 72)]
    )
    assert len([m for _, m in notes(c) if m[0] == 144]) == len([m for _, m in notes(c) if m[0] == 128])


def test_variant_preflight_rejects_limit_plus_one_before_allocation(monkeypatch):
    from types import SimpleNamespace
    from backend.app.services import clip_transposition as transforms

    too_many = plan(c=12, entries=[(i, i % 127 + 1, i // 127) for i in range(256)])
    prepared = PreparedClipSchedule(ClipSchedule.model_validate(wire([too_many])))
    with pytest.raises(ValueError, match="variant limit"):
        prepared.variant_pairs()
    monkeypatch.setattr(transforms, "variant", lambda *_: pytest.fail("allocated before preflight"))
    pad = SimpleNamespace(score_by_id=dict.fromkeys(range(100001)))
    track = SimpleNamespace(
        track_id="score",
        clip_schedule=PreparedClipSchedule(ClipSchedule.model_validate(wire([plan(c=12, entries=[(1, 0, 24)])]))),
        audition_schedule=None,
        pads={0: pad},
    )
    with pytest.raises(ValueError, match="score-record"):
        transforms.prepare_variants({"score": track})


def test_content_cache_reuses_variants_and_enforces_byte_budget(monkeypatch):
    from dataclasses import replace
    from backend.app.services import clip_transposition as transforms

    runtime, _, _ = make_runtime([60, None, None, None])
    pad = runtime._config.tracks["lead"].pads[0]
    transforms._cache.clear()
    transforms._cache_records = transforms._cache_bytes = 0
    first = transforms.variant(pad, (0, 12))
    assert transforms.variant(pad, (0, 12)) is first
    changed = replace(pad, steps=(replace(pad.steps[0], notes=(62,)), *pad.steps[1:]))
    assert transforms.variant(changed, (0, 12)).steps[0].notes == (74,)
    monkeypatch.setattr(transforms, "MAX_CACHE_BYTES", 1)
    transforms.variant(pad, (0, 24))
    assert not transforms._cache and transforms._cache_bytes == 0


def test_runtime_rejects_controller_and_drum_pitch_plans():
    from backend.app.models.session import SessionControllerSequencerTrackConfig, SessionSequencerTrackConfig

    for constructor, identity in [
        (SessionControllerSequencerTrackConfig, "cc"),
        (SessionSequencerTrackConfig, "drumrow:kit:one"),
    ]:
        with pytest.raises(ValueError, match="unavailable"):
            constructor(
                **({"controller_number": 1} if identity == "cc" else {}),
                track_id=identity,
                pad_loop_enabled=True,
                clip_schedule=wire(),
                pads=[dict(pad_index=0, length_beats=1, steps=[60])],
            )


def test_rapid_future_edits_keep_pair_and_update_unstarted_musical_notes():
    from backend.app.models.session import SessionSequencerConfigRequest

    steps = [dict(note=60, timing_offset_percent=-25), 62, None, None]
    r, c, config = make_runtime(steps, pad_loop_enabled=True, clip_schedule=wire([plan(entries=[(1, 0, 12)])]))
    advance(r, c, 3200)
    payload = config.model_dump()
    for pitch, amount in [(65, 24), (67, 36)]:
        payload["tracks"][0]["pads"][0]["steps"][1] = pitch
        payload["tracks"][0]["clip_schedule"] = wire([plan(entries=[(1, 0, amount)])])
        r.configure(SessionSequencerConfigRequest.model_validate(payload))
    advance(r, c, 5000)
    assert [(at, m[1]) for at, m in notes(c) if m[0] == 144][-2:] == [(3150, 72), (4200, 79)]


def test_authored_variant_preflight_rejects_before_persistence():
    from backend.app.models.clip_validation import validate_authored_clips

    config = json.loads((Path(__file__).parent / "fixtures/clip_transposition/performance.json").read_text())
    config["sequencer"]["clipArrangement"]["lanes"][0]["transposeProfiles"][0]["plan"] = plan(
        c=12, entries=[(i, i % 127 + 1, i // 127) for i in range(256)]
    )
    with pytest.raises(ValueError, match="variant"):
        validate_authored_clips(config)


def test_stop_restart_same_occurrence_discards_transpose_latch():
    from backend.app.models.session import SessionSequencerConfigRequest

    r, c, config = make_runtime([60, None, None, None], pad_loop_enabled=True, clip_schedule=wire([plan()]))
    advance(r, c, 100)
    payload = config.model_dump()
    payload["tracks"][0]["clip_schedule"] = wire([plan(c=12)])
    r.configure(SessionSequencerConfigRequest.model_validate(payload))
    r.stop()
    r.start(position_step=0)
    advance(r, c, 300)
    assert [m[1] for _, m in notes(c) if m[0] == 144] == [60, 72]


def test_pending_status_identifies_next_uncommitted_occurrence():
    from backend.app.models.session import SessionSequencerConfigRequest

    r, c, config = make_runtime(
        [dict(note=60, timing_offset_percent=-25), None, None, None],
        pad_loop_enabled=True,
        clip_schedule=wire([plan(entries=[(1, 0, 12)])]),
    )
    advance(r, c, 3200)
    payload = config.model_dump()
    payload["tracks"][0]["clip_schedule"] = wire([plan(c=24)])
    r.configure(SessionSequencerConfigRequest.model_validate(payload))
    assert r.status().tracks[0].transpose_pending == dict(
        clip_id="clip", logical_pass=2, leaf_index=0, at_subunit=2 * Q
    )
    r.stop()
    assert r.status().tracks[0].transpose_pending is None
