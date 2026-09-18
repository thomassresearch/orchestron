from __future__ import annotations

from backend.app.models.session import SessionAuditionRequest


class PreviewCommands:
    """Session-local ordering, including end-before-start tombstones and retries."""

    def __init__(self):
        self._commands: dict[str, tuple[int, str, str, tuple[int, ...]]] = {}

    def accept(self, identities: list[str], request: SessionAuditionRequest) -> bool:
        command = (request.revision, request.gesture_id, request.action, tuple(request.sequence))
        previous = [self._commands.get(identity) for identity in identities]
        if any(old and (command[0] < old[0] or command[0] == old[0] and command != old) for old in previous):
            raise ValueError("Stale preview command.")
        if previous and all(old == command for old in previous):
            return False
        for identity in identities:
            self._commands[identity] = command
        return True

    def retain(self, identities):
        self._commands = {key: value for key, value in self._commands.items() if key in identities}
