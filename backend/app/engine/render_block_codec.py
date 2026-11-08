"""Internal empty-event block codec, bound to a validated epoch's bootstrap.

The bootstrap digest identifies the partition, plan, artifact, engine format and
complete batch bus layout. Sequence determines both slot and generation; a bounded
step count specifies the interval without changing synthesis ksmps. This avoids
repeating those immutable fields as JSON for every control block. MIDI/control
blocks and lifecycle/error messages retain the validated protocol models.
Publication still requires the existing semaphore release/acquire fence.
"""
from __future__ import annotations

import struct

RENDER_MAGIC = b"RBL2"
DONE_MAGIC = b"DBL2"
BLOCK = struct.Struct("<4s32sQQQI")


class SteadyBlockCodec:
    def __init__(self, bootstrap_hash):
        self.token = bytes.fromhex(bootstrap_hash)
        if len(self.token) != 32:
            raise ValueError("Invalid block bootstrap digest.")

    def render(self, sequence, sample, revision, blocks=1):
        # pack rejects negative/out-of-range counters before any dispatch.
        return BLOCK.pack(RENDER_MAGIC, self.token, sequence, sample, revision, blocks)

    def validate(self, data, *, sequence, sample, revision, max_blocks=1):
        if len(data) != BLOCK.size:
            raise ValueError("Invalid compact block length.")
        magic, token, received_sequence, received_sample, received_revision, blocks = BLOCK.unpack(data)
        if (magic != RENDER_MAGIC or token != self.token or received_sequence != sequence
                or received_sample != sample or received_revision < revision or not 1 <= blocks <= max_blocks):
            raise ValueError("Compact block sequence/range/revision/ownership mismatch.")
        return received_revision, blocks

    @staticmethod
    def done(data):
        return DONE_MAGIC + data[4:]
