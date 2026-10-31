"""Bounded controller state shared by API edits and render-boundary MIDI delivery."""
from __future__ import annotations

import threading

from backend.app.models.performance_controller import PerformanceControllerDefinition
from backend.app.services.performance_controller_service import (
    controller_midi_value, validate_controller_midi_ccs, validate_controller_values,
)


class ControllerRevisionConflict(Exception):
    pass


class PerformanceControllers:
    def __init__(self, queue_controls):
        self._lock = threading.RLock()
        self._queue_controls = queue_controls
        self._assignments = {}
        self._bindings = {}
        self._definitions = {}
        self._revisions = {}
        self._midi_revisions = {}
        self._routes = {}
        self._dirty = False

    @property
    def configured(self):
        return bool(self._assignments)

    @property
    def bindings(self):
        return self._bindings

    def configure(self, assignments, manifest):
        with self._lock:
            self._assignments = {item.id: item for item in assignments}
            self._bindings = manifest
            self._definitions = {identity: {node: PerformanceControllerDefinition.model_validate(binding)
                for node, binding in bindings.items()} for identity, bindings in manifest.items()}
            # Recompilation does not make an old request current again.
            self._revisions = {identity: {node: self._revisions.get(identity, {}).get(node, 0) + 1
                for node in bindings} for identity, bindings in manifest.items()}
            self._midi_revisions = {identity: {node: self._midi_revisions.get(identity, {}).get(node, 0) + 1
                for node in bindings} for identity, bindings in manifest.items()}
            self._rebuild_routes()
            self._dirty = True

    def _rebuild_routes(self):
        routes = {}
        for identity, assignment in self._assignments.items():
            definitions = self._definitions.get(identity, {})
            validate_controller_midi_ccs(definitions.values(), assignment.performance_controller_midi_ccs, assignment.midi_channel)
            for node, cc in assignment.performance_controller_midi_ccs.items():
                routes.setdefault((assignment.midi_channel, cc), []).append((identity, node, definitions[node]))
        self._routes = routes

    def snapshot(self, identity=None):
        with self._lock:
            if identity is None:
                return {key: self.snapshot(key) for key in self._bindings}
            assignment = self._assignments[identity]
            return {"values": dict(assignment.performance_controller_values),
                    "midi_ccs": dict(assignment.performance_controller_midi_ccs),
                    "revisions": dict(self._revisions.get(identity, {})),
                    "midi_revisions": dict(self._midi_revisions.get(identity, {}))}

    def drain(self):
        with self._lock:
            if not self._dirty:
                return None
            self._dirty = False
            return self.snapshot()

    def update(self, identity, values, midi_ccs=None, revisions=None, *, replace=False, midi_revisions=None):
        with self._lock:
            assignment = self._assignments[identity]
            definitions = self._definitions.get(identity, {})
            midi_ccs = midi_ccs or {}
            touched = set(values) | set(midi_ccs)
            if replace:
                touched |= set(assignment.performance_controller_values)
            if touched - definitions.keys():
                validate_controller_values(definitions.values(), {node: 0 for node in touched})
            if revisions is not None and any(revisions.get(node) != self._revisions[identity][node] for node in (set(values) | (touched if replace else set()))):
                raise ControllerRevisionConflict()
            if revisions is not None and any(
                (midi_revisions[node] != self._midi_revisions[identity][node]) if midi_revisions and node in midi_revisions
                else (revisions.get(node) != self._revisions[identity][node]) for node in midi_ccs):
                raise ControllerRevisionConflict()
            next_values = {} if replace else dict(assignment.performance_controller_values)
            next_ccs = dict(assignment.performance_controller_midi_ccs)
            for changes, target in ((values, next_values), (midi_ccs, next_ccs)):
                for node, value in changes.items():
                    if value is None:
                        target.pop(node, None)
                    else:
                        target[node] = value
            validate_controller_values(definitions.values(), next_values)
            validate_controller_midi_ccs(definitions.values(), next_ccs, assignment.midi_channel)
            assignment.performance_controller_values = next_values
            assignment.performance_controller_midi_ccs = next_ccs
            for node in touched:
                self._revisions[identity][node] += 1
            self._queue_controls({self._bindings[identity][node]["channel"]: next_values.get(node, definitions[node].default)
                for node in (set(values) | (touched if replace else set()))})
            if midi_ccs:
                for node in midi_ccs:
                    self._midi_revisions[identity][node] += 1
                self._rebuild_routes()
            self._dirty = True
            return self.snapshot(identity)

    def deliver(self, events):
        if not self._routes:
            return
        with self._lock:
            controls = {}
            for event in events:
                status, cc, raw_value = event.message
                if status & 0xF0 != 0xB0:
                    continue
                for identity, node, definition in self._routes.get(((status & 15) + 1, cc), ()):
                    assignment = self._assignments[identity]
                    value = controller_midi_value(raw_value, definition)
                    # Even an unchanged CC invalidates a GUI edit based on older input.
                    self._revisions[identity][node] += 1
                    assignment.performance_controller_values = {**assignment.performance_controller_values, node: value}
                    controls[self._bindings[identity][node]["channel"]] = value
                    self._dirty = True
            if controls:
                self._queue_controls(controls)
