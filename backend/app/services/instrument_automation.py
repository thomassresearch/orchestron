"""Validate derived routing against the actual rack, for live and offline playback."""


def validate_automation_routing(config, instruments, proposed_mappings=None):
    assignments = {item.id: item for item in instruments}
    seen = set()
    for track in config.controller_tracks:
        target = track.automation_target
        if target is None:
            continue
        assignment = assignments.get(target.instrument_id)
        mappings = ((proposed_mappings or {}).get(target.instrument_id, assignment.performance_controller_midi_ccs)
                    if assignment else {})
        ccs = {mappings[node] for node in target.controller_node_ids if node in mappings}
        if not assignment or not 1 <= assignment.midi_channel <= 16 or len(ccs) != 1 or any(node not in mappings for node in target.controller_node_ids):
            if track.enabled:
                raise ValueError("Unmapped instrument automation must be suspended.")
            continue
        cc = next(iter(ccs))
        if track.controller_number != cc or track.target_channels != [assignment.midi_channel]:
            raise ValueError("Automation MIDI CC and channel must match the owning rack instrument.")
        key = (target.instrument_id, cc)
        if key in seen:
            raise ValueError("Only one automation lane per rack instrument and MIDI CC is allowed.")
        seen.add(key)
