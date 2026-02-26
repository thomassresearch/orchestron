from __future__ import annotations

from io import BytesIO
import json
from pathlib import PurePosixPath
import zipfile

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer

router = APIRouter(prefix="/bundles", tags=["bundles"])


@router.post("/export/patch")
async def export_patch_bundle(
    payload: dict[str, object],
    container: AppContainer = Depends(get_container),
) -> Response:
    return _build_export_response(
        payload=payload,
        json_entry_name="instrument.orch.instrument.json",
        container=container,
    )


@router.post("/export/performance")
async def export_performance_bundle(
    payload: dict[str, object],
    container: AppContainer = Depends(get_container),
) -> Response:
    return _build_export_response(
        payload=payload,
        json_entry_name="performance.orch.json",
        container=container,
    )


@router.post("/import/expand")
async def expand_import_bundle(
    request: Request,
    x_file_name: str | None = Header(default=None, alias="X-File-Name"),
    container: AppContainer = Depends(get_container),
) -> JSONResponse:
    payload = await request.body()
    if not payload:
        raise HTTPException(status_code=400, detail="Import file is empty.")

    try:
        parsed = _expand_import_payload(
            payload=payload,
            filename=x_file_name,
            container=container,
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    return JSONResponse(content=parsed)


def _build_export_response(
    *,
    payload: dict[str, object],
    json_entry_name: str,
    container: AppContainer,
) -> Response:
    json_bytes = json.dumps(payload, ensure_ascii=True, indent=2).encode("utf-8")
    stored_names = sorted(_collect_referenced_gen_audio_stored_names_from_payload(payload))
    if not stored_names:
        return Response(
            content=json_bytes,
            media_type="application/json",
            headers={"X-Orchestron-Export-Format": "json"},
        )

    archive_buffer = BytesIO()
    try:
        with zipfile.ZipFile(archive_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(json_entry_name, json_bytes)
            for stored_name in stored_names:
                source_path = container.gen_asset_service.resolve_audio_path(stored_name)
                if not source_path.exists():
                    raise ValueError(f"Referenced GEN audio asset '{stored_name}' does not exist on the backend.")
                archive.writestr(f"audio/{stored_name}", source_path.read_bytes())
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    return Response(
        content=archive_buffer.getvalue(),
        media_type="application/zip",
        headers={"X-Orchestron-Export-Format": "zip"},
    )


def _expand_import_payload(
    *,
    payload: bytes,
    filename: str | None,
    container: AppContainer,
) -> object:
    if _looks_like_zip(payload=payload, filename=filename):
        return _expand_zip_import_payload(payload=payload, container=container)

    try:
        decoded = payload.decode("utf-8")
    except UnicodeDecodeError as err:
        raise ValueError("Import file is neither valid UTF-8 JSON nor a ZIP archive.") from err
    try:
        return json.loads(decoded)
    except json.JSONDecodeError as err:
        raise ValueError(f"Import JSON could not be parsed: {err.msg}") from err


def _expand_zip_import_payload(*, payload: bytes, container: AppContainer) -> object:
    try:
        archive = zipfile.ZipFile(BytesIO(payload))
    except zipfile.BadZipFile as err:
        raise ValueError("Import ZIP archive is invalid.") from err

    with archive:
        members = [item for item in archive.infolist() if not item.is_dir()]
        json_entries = [item for item in members if _is_root_json_entry(item.filename)]
        if len(json_entries) != 1:
            raise ValueError("Import ZIP must contain exactly one JSON file at the archive root.")

        try:
            parsed = json.loads(archive.read(json_entries[0]).decode("utf-8"))
        except UnicodeDecodeError as err:
            raise ValueError("Import ZIP JSON file must be UTF-8 encoded.") from err
        except json.JSONDecodeError as err:
            raise ValueError(f"Import ZIP JSON could not be parsed: {err.msg}") from err

        referenced_names = _collect_referenced_gen_audio_stored_names_from_payload(parsed)
        if not referenced_names:
            return parsed

        member_by_normalized_name = {
            _normalize_zip_member_name(member.filename): member for member in members
        }
        for stored_name in sorted(referenced_names):
            expected_member_name = f"audio/{stored_name}"
            member = member_by_normalized_name.get(expected_member_name)
            if member is None:
                raise ValueError(
                    f"Import ZIP is missing referenced GEN audio asset 'audio/{stored_name}'."
                )
            container.gen_asset_service.import_audio_bytes_with_stored_name(
                stored_name=stored_name,
                payload=archive.read(member),
                original_name=stored_name,
            )

        return parsed


def _collect_referenced_gen_audio_stored_names_from_payload(raw: object) -> set[str]:
    names: set[str] = set()
    if not isinstance(raw, dict):
        return names

    if isinstance(raw.get("graph"), dict):
        names.update(_collect_referenced_gen_audio_stored_names_from_graph(raw.get("graph")))

    patch_definitions = raw.get("patch_definitions")
    if isinstance(patch_definitions, list):
        for entry in patch_definitions:
            if not isinstance(entry, dict):
                continue
            graph = entry.get("graph")
            if isinstance(graph, dict):
                names.update(_collect_referenced_gen_audio_stored_names_from_graph(graph))

    return names


def _collect_referenced_gen_audio_stored_names_from_graph(graph: object) -> set[str]:
    names: set[str] = set()
    if not isinstance(graph, dict):
        return names
    ui_layout = graph.get("ui_layout")
    if not isinstance(ui_layout, dict):
        return names
    gen_nodes = ui_layout.get("gen_nodes")
    if isinstance(gen_nodes, dict):
        for raw_node_config in gen_nodes.values():
            if not isinstance(raw_node_config, dict):
                continue
            if not _is_gen01_node_config(raw_node_config):
                continue
            _add_sample_asset_stored_name(names, raw_node_config.get("sampleAsset"))

    sfload_nodes = ui_layout.get("sfload_nodes")
    if isinstance(sfload_nodes, dict):
        for raw_node_config in sfload_nodes.values():
            if not isinstance(raw_node_config, dict):
                continue
            _add_sample_asset_stored_name(names, raw_node_config.get("sampleAsset"))
    return names


def _is_gen01_node_config(raw_node_config: dict[str, object]) -> bool:
    routine_name = raw_node_config.get("routineName")
    if isinstance(routine_name, str):
        normalized = routine_name.strip().lower()
        if normalized:
            return normalized in {"1", "gen1", "gen01"}

    routine_number = _coerce_int(raw_node_config.get("routineNumber"), default=10)
    return abs(routine_number) == 1


def _add_sample_asset_stored_name(names: set[str], sample_asset: object) -> None:
    if not isinstance(sample_asset, dict):
        return
    stored_name = sample_asset.get("stored_name")
    if not isinstance(stored_name, str):
        return
    trimmed = stored_name.strip()
    if trimmed:
        names.add(trimmed)


def _looks_like_zip(*, payload: bytes, filename: str | None) -> bool:
    if payload.startswith(b"PK\x03\x04") or payload.startswith(b"PK\x05\x06") or payload.startswith(b"PK\x07\x08"):
        return True
    if isinstance(filename, str) and filename.strip().lower().endswith(".zip"):
        return True
    return False


def _is_root_json_entry(member_name: str) -> bool:
    normalized = _normalize_zip_member_name(member_name)
    if not normalized or normalized.startswith("audio/"):
        return False
    return "/" not in normalized and normalized.lower().endswith(".json")


def _normalize_zip_member_name(member_name: str) -> str:
    normalized = member_name.replace("\\", "/").strip("/")
    if not normalized:
        return ""
    path = PurePosixPath(normalized)
    if any(part in {"", ".", ".."} for part in path.parts):
        return ""
    return "/".join(path.parts)


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
