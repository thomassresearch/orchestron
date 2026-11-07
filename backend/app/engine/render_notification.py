"""Bounded completion wakeups; never carry audio or protocol messages.

Darwin emulates timed semaphore waits with sleeps. At K=32 that delay alone
exceeds an audio block. A datagram wakes select immediately, without polling or
busy spinning. Linux retains its native timed semaphore. Mailbox ownership
allows at most one outstanding notification; a full socket fails, never blocks.
"""
from __future__ import annotations

import select
import socket
import sys


class SocketNotification:
    def __init__(self, context):
        # Retain an explicit release/acquire memory fence for shared mailbox and
        # audio visibility. Only the timed waiting mechanism changes on Darwin.
        self.fence = context.Semaphore(0)
        self.reader, self.writer = socket.socketpair(type=socket.SOCK_DGRAM)
        self.reader.setblocking(False)
        self.writer.setblocking(False)

    def acquire(self, block=True, timeout=None):
        if not select.select([self.reader], [], [], timeout if block else 0)[0]:
            return False
        if self.reader.recv(1) != b"x" or not self.fence.acquire(False):
            raise RuntimeError("Invalid completion notification")
        return True

    def release(self):
        self.fence.release()
        self.writer.send(b"x")

    def close(self):
        self.reader.close()
        self.writer.close()


def completion_notification(context):
    return SocketNotification(context) if sys.platform == "darwin" else context.Semaphore(0)
