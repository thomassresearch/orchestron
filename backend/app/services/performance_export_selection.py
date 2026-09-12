"""Select the rack instances and assets needed by an offline performance export."""

from backend.app.models.export import PerformanceCsdExportRequest, PerformanceExportPayload
from backend.app.services.compiler_mixer import token


def _device_channels(request: PerformanceCsdExportRequest) -> set[int]:
    # Runtime tracks also cover drummer tracks and older/API-only exports. The
    # browser's transport placeholder is not a device assignment.
    channels = {track.midi_channel for track in request.sequencer_config.tracks if track.track_id != "__transport__"}
    channels.update(arp.target_channel for arp in request.sequencer_config.arpeggiators)
    snapshot = (request.performance_export.performance.config.model_extra or {}).get("sequencer", {})
    if isinstance(snapshot, dict):
        for collection, key in (
            ("tracks", "midiChannel"),
            ("drummerTracks", "midiChannel"),
            ("pianoRolls", "midiChannel"),
            ("arpeggiators", "targetChannel"),
        ):
            devices = snapshot.get(collection, [])
            if not isinstance(devices, list):
                continue
            for device in devices:
                channel = device.get(key) if isinstance(device, dict) else None
                if type(channel) is int and 1 <= channel <= 16:
                    channels.add(channel)
    return channels


def select_performance_csd_instruments(request: PerformanceCsdExportRequest) -> PerformanceExportPayload:
    """Filter copies before resolving assets or compiling; preserve the saved rack."""
    exported = request.performance_export
    config = exported.performance.config
    definitions = {patch.source_patch_id: patch for patch in exported.patch_definitions}
    channels = _device_channels(request)
    routed_ids: set[str] = set()
    graph = config.audio_graph
    if graph is not None:
        for route in graph.routes:
            routed_ids.update((route.source_id, route.target_id))
        if graph.master_id is not None:
            routed_ids.add(graph.master_id)
        routed_ids.update(graph.insert_owners)
        routed_ids.update(graph.insert_owners.values())
    else:
        for instrument in config.instruments:
            sources = {*instrument.effect_source_ids, *(route.source_id for route in instrument.effect_routes)}
            if sources:
                routed_ids.update(sources)
                if instrument.id is not None:
                    routed_ids.add(instrument.id)

    instruments = []
    for instrument in config.instruments:
        definition = definitions.get(instrument.patch_id)
        if definition is not None and definition.always_on:
            # Input-free continuous generators with outs have an implicit mixer
            # route to Audio Output even when no explicit routes are stored.
            opcodes = {node.opcode for node in definition.graph.nodes}
            if instrument.id in routed_ids or ("outs" in opcodes and "inleta" not in opcodes):
                instruments.append(instrument)
        elif instrument.midi_channel in channels:
            instruments.append(instrument)

    dropped_ids = {item.id for item in config.instruments if item not in instruments and item.id is not None}
    if graph is not None:
        routes = [r for r in graph.routes if r.source_id not in dropped_ids and r.target_id not in dropped_ids]
        dropped_route_ids = {r.id for r in graph.routes if r not in routes}
        # The compiler generates these direct-output routes, so their controls
        # can appear in the saved mixer without appearing in the explicit graph.
        dropped_route_ids.update(
            "direct_" + token(identity + side) for identity in dropped_ids for side in ("left", "right")
        )
        graph = graph.model_copy(
            update={
                "routes": routes,
                "master_id": None if graph.master_id in dropped_ids else graph.master_id,
                "insert_owners": {
                    processor: owner
                    for processor, owner in graph.insert_owners.items()
                    if processor not in dropped_ids and owner not in dropped_ids
                },
            }
        )
    else:
        dropped_route_ids = set()
        instruments = [
            item.model_copy(
                update={
                    "effect_source_ids": [source for source in item.effect_source_ids if source not in dropped_ids],
                    "effect_routes": [route for route in item.effect_routes if route.source_id not in dropped_ids],
                }
            )
            for item in instruments
        ]

    # Unknown IDs are left intact so validation still reports broken routing;
    # only references to deliberately omitted instances are removed.
    mixer = config.mixer.model_copy(
        update={
            "strips": {key: value for key, value in config.mixer.strips.items() if key not in dropped_ids},
            "sends": {key: value for key, value in config.mixer.sends.items() if key not in dropped_route_ids},
        }
    )
    selected_config = config.model_copy(update={"instruments": instruments, "audio_graph": graph, "mixer": mixer})
    patch_ids = {item.patch_id for item in instruments}
    return exported.model_copy(
        update={
            "performance": exported.performance.model_copy(update={"config": selected_config}),
            "patch_definitions": [patch for patch in exported.patch_definitions if patch.source_patch_id in patch_ids],
        }
    )
