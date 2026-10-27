from backend.app.engine.live_midi_activity import LiveMidiActivity
from backend.app.models.session import SessionMidiEventRequest


def test_live_input_tracks_retriggers_channels_sustain_and_reset():
    activity = LiveMidiActivity()

    def midi(kind, channel=1, **values):
        activity.record(SessionMidiEventRequest(type=kind, channel=channel, **values), "host-a")

    midi("note_on", note=60, velocity=100)
    midi("note_on", note=60, velocity=100)
    midi("note_on", channel=2, note=60, velocity=100)
    midi("note_on", note=60, velocity=0)
    assert activity.notes == {(2, 60)}
    midi("control_change", controller=64, value=127)
    midi("note_off", channel=2, note=60)
    assert activity.held
    midi("control_change", controller=64, value=0)
    assert not activity.held
    midi("control_change", controller=74, value=40)
    assert not activity.held
    midi("control_change", controller=64, value=127)
    midi("control_change", controller=121, value=0)
    assert not activity.held
    midi("note_on", note=60)
    midi("control_change", controller=64, value=127)
    midi("all_notes_off")
    assert not activity.held
    midi("note_on", note=61)
    activity.reset()
    assert activity.host_id is None and not activity.held
