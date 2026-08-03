from __future__ import annotations

from backend.app.services.browser_clock_policy import BrowserClockControllerLease


class SessionConnectionRegistry:
    """Owns frontend and browser-clock controller connection membership.

    SessionService remains responsible for locking, watchdog tasks, close frames,
    and lifecycle side effects.
    """

    def __init__(self) -> None:
        self._frontend_connections: dict[str, set[str]] = {}
        self._browser_clock_controllers: dict[str, BrowserClockControllerLease] = {}

    def add_frontend(self, session_id: str, connection_id: str) -> None:
        self._frontend_connections.setdefault(session_id, set()).add(connection_id)

    def contains_frontend(self, session_id: str, connection_id: str) -> bool:
        return connection_id in self._frontend_connections.get(session_id, set())

    def remove_frontend(self, session_id: str, connection_id: str) -> bool:
        connections = self._frontend_connections.get(session_id)
        if not connections or connection_id not in connections:
            return False
        connections.discard(connection_id)
        if not connections:
            self._frontend_connections.pop(session_id, None)
        return True

    def has_frontend(self, session_id: str) -> bool:
        return bool(self._frontend_connections.get(session_id))

    def clear_frontend(self, session_id: str) -> None:
        self._frontend_connections.pop(session_id, None)

    def replace_browser_controller(
        self,
        session_id: str,
        lease: BrowserClockControllerLease,
    ) -> BrowserClockControllerLease | None:
        previous = self._browser_clock_controllers.get(session_id)
        self._browser_clock_controllers[session_id] = lease
        return previous

    def browser_controller(self, session_id: str) -> BrowserClockControllerLease | None:
        return self._browser_clock_controllers.get(session_id)

    def remove_browser_controller(
        self,
        session_id: str,
        *,
        connection_id: str | None = None,
    ) -> BrowserClockControllerLease | None:
        lease = self._browser_clock_controllers.get(session_id)
        if lease is None or (connection_id is not None and lease.connection_id != connection_id):
            return None
        return self._browser_clock_controllers.pop(session_id, None)

    def has_browser_controller(self, session_id: str) -> bool:
        return session_id in self._browser_clock_controllers
