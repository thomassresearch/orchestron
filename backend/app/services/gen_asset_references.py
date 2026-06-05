from __future__ import annotations

from pathlib import PurePosixPath


def collect_referenced_gen_audio_stored_names_from_payload(raw: object) -> set[str]:
    names: set[str] = set()
    payload = _as_dict(raw)
    if payload is None:
        return names

    graph = payload.get("graph")
    if graph is not None:
        names.update(collect_referenced_gen_audio_stored_names_from_graph(graph))

    patch_definitions = payload.get("patch_definitions")
    if not isinstance(patch_definitions, list):
        patch_definitions = payload.get("patchDefinitions")
    if isinstance(patch_definitions, list):
        for entry in patch_definitions:
            entry_payload = _as_dict(entry)
            if entry_payload is None:
                continue
            graph = entry_payload.get("graph")
            if graph is not None:
                names.update(collect_referenced_gen_audio_stored_names_from_graph(graph))

    return names


def collect_referenced_gen_audio_stored_names_from_graph(graph: object) -> set[str]:
    names: set[str] = set()
    graph_payload = _as_dict(graph)
    if graph_payload is None:
        return names
    ui_layout = _as_dict(graph_payload.get("ui_layout"))
    if ui_layout is None:
        return names

    gen_nodes = ui_layout.get("gen_nodes")
    if isinstance(gen_nodes, dict):
        for raw_node_config in gen_nodes.values():
            node_config = _as_dict(raw_node_config)
            if node_config is None or not _is_gen01_node_config(node_config):
                continue
            _add_sample_asset_stored_name(names, node_config.get("sampleAsset"))

    sfload_nodes = ui_layout.get("sfload_nodes")
    if isinstance(sfload_nodes, dict):
        for raw_node_config in sfload_nodes.values():
            node_config = _as_dict(raw_node_config)
            if node_config is None:
                continue
            _add_sample_asset_stored_name(names, node_config.get("sampleAsset"))
    return names


def collect_persisted_gen_audio_stored_names(
    *,
    patch_documents: object,
    performance_documents: object,
) -> set[str]:
    names: set[str] = set()
    if isinstance(patch_documents, (list, tuple)):
        iterable_patch_documents = patch_documents
    else:
        iterable_patch_documents = list(patch_documents)
    for document in iterable_patch_documents:
        graph = getattr(document, "graph", None)
        if graph is not None:
            names.update(collect_referenced_gen_audio_stored_names_from_graph(graph))

    if isinstance(performance_documents, (list, tuple)):
        iterable_performance_documents = performance_documents
    else:
        iterable_performance_documents = list(performance_documents)
    for document in iterable_performance_documents:
        config = getattr(document, "config", None)
        if config is not None:
            names.update(collect_referenced_gen_audio_stored_names_from_payload(config))
    return names


def normalize_zip_member_name(member_name: str) -> str:
    raw = member_name.replace("\\", "/")
    if raw.startswith("/"):
        return ""
    normalized = raw.strip("/")
    if not normalized:
        return ""
    path = PurePosixPath(normalized)
    if any(part in {"", ".", ".."} for part in path.parts):
        return ""
    return "/".join(path.parts)


def is_root_json_entry(member_name: str) -> bool:
    normalized = normalize_zip_member_name(member_name)
    if not normalized or normalized.startswith("audio/"):
        return False
    return "/" not in normalized and normalized.lower().endswith(".json")


def _add_sample_asset_stored_name(names: set[str], sample_asset: object) -> None:
    asset = _as_dict(sample_asset)
    if asset is None:
        return
    stored_name = asset.get("stored_name")
    if not isinstance(stored_name, str):
        return
    trimmed = stored_name.strip()
    if trimmed:
        names.add(trimmed)


def _is_gen01_node_config(raw_node_config: dict[str, object]) -> bool:
    routine_name = raw_node_config.get("routineName")
    if isinstance(routine_name, str):
        normalized = routine_name.strip().lower()
        if normalized:
            return normalized in {"1", "gen1", "gen01"}

    routine_number = _coerce_int(raw_node_config.get("routineNumber"), default=10)
    return abs(routine_number) == 1


def _coerce_int(value: object, *, default: int) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value.strip()))
        except ValueError:
            return default
    return default


def _as_dict(value: object) -> dict[str, object] | None:
    if isinstance(value, dict):
        return value
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        dumped = model_dump(mode="json", by_alias=False)
        if isinstance(dumped, dict):
            return dumped
    return None
