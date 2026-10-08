# Cython augmentation of the shared Python source. Keep event positions as objects.
cimport cython

@cython.locals(denominator=cython.long, numerator=cython.long,
               rate_denominator=cython.long, steps=cython.long, local_beat=cython.long)
cpdef long timing_span(object timing) except -1

cpdef inline object _active_pad_runtime(object track)
cpdef inline object _active_pad_step_count(object track)
cpdef inline object _active_pad_transport_subunit_count(object track)
cpdef inline object _current_pad_loop_token(object track)
cpdef inline object _local_step_for(object track, object transport_subunit)
cpdef inline object _local_transport_offset_for(object track, object transport_subunit)
cpdef inline object _pause_beat_count_from_token(object token)
cpdef inline object _step_count_for_loop_token(object track, object token)
cpdef inline object _step_count_for_pad(object track, object pad_index)
cpdef inline object _step_count_for_pause(object pause_beat_count, object timing)
cpdef inline object _track_cycle_boundary_reached_for_next_subunit(object track, object next_subunit)
cpdef inline object _transport_subunit_count_for_length(object length_beats, object timing)
cpdef inline object _transport_subunit_count_for_loop_token(object track, object token)
cpdef inline object _transport_subunit_count_for_pad(object track, object pad_index)
cpdef inline object _transport_subunits_per_local_step(object track)
