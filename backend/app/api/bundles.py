from __future__ import annotations

from io import BytesIO
import json
from pathlib import PurePosixPath
from tempfile import SpooledTemporaryFile
from typing import BinaryIO
import zipfile

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.export import PerformanceCsdExportRequest
from backend.app.services.compiler_service import CompilationError
from backend.app.services.performance_export_service import PerformanceExportService

router = APIRouter(prefix="/bundles", tags=["bundles"])

_IMPORT_READ_CHUNK_BYTES = 1024 * 1024
_ZIP_MAGIC_PREFIXES = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")


class ImportBundleTooLargeError(ValueError):
    pass


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


@router.post("/export/performance-csd")
async def export_performance_csd_bundle(
    payload: PerformanceCsdExportRequest,
    container: AppContainer = Depends(get_container),
) -> Response:
    exporter = PerformanceExportService(
        compiler_service=container.compiler_service,
        gen_asset_service=container.gen_asset_service,
    )
    try:
        archive_bytes = exporter.build_performance_csd_archive(payload)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except CompilationError as err:
        raise HTTPException(status_code=422, detail={"diagnostics": err.diagnostics}) from err

    return Response(
        content=archive_bytes,
        media_type="application/zip",
        headers={"X-Orchestron-Export-Format": "zip"},
    )


@router.post("/import/expand")
async def expand_import_bundle(
    request: Request,
    x_file_name: str | None = Header(default=None, alias="X-File-Name"),
    container: AppContainer = Depends(get_container),
) -> JSONResponse:
    _reject_declared_oversized_import(
        content_length=request.headers.get("content-length"),
        max_size=container.settings.bundle_import_max_bytes,
    )

    payload_file: BinaryIO | None = None
    try:
        payload_file = await _read_limited_import_body(
            request=request,
            max_size=container.settings.bundle_import_max_bytes,
        )
        parsed = _expand_import_payload(
            payload_file=payload_file,
            filename=x_file_name,
            container=container,
        )
    except ImportBundleTooLargeError as err:
        raise HTTPException(status_code=413, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    finally:
        if payload_file is not None:
            payload_file.close()

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
    payload_file: BinaryIO,
    filename: str | None,
    container: AppContainer,
) -> object:
    payload_file.seek(0)
    prefix = payload_file.read(4)
    payload_file.seek(0)
    if _looks_like_zip(prefix=prefix, filename=filename):
        return _expand_zip_import_payload(payload_file=payload_file, container=container)

    try:
        payload = _read_limited_file_bytes(
            payload_file,
            max_size=container.settings.bundle_import_json_max_bytes,
            too_large_message=(
                "Import JSON exceeds maximum size "
                f"({container.settings.bundle_import_json_max_bytes} bytes)."
            ),
        )
        decoded = payload.decode("utf-8")
    except UnicodeDecodeError as err:
        raise ValueError("Import file is neither valid UTF-8 JSON nor a ZIP archive.") from err
    try:
        return json.loads(decoded)
    except json.JSONDecodeError as err:
        raise ValueError(f"Import JSON could not be parsed: {err.msg}") from err


def _expand_zip_import_payload(*, payload_file: BinaryIO, container: AppContainer) -> object:
    payload_file.seek(0)
    try:
        archive = zipfile.ZipFile(payload_file)
    except zipfile.BadZipFile as err:
        raise ValueError("Import ZIP archive is invalid.") from err

    with archive:
        member_by_normalized_name = _validate_zip_import_metadata(archive=archive, container=container)
        json_entries = [
            member
            for normalized_name, member in member_by_normalized_name.items()
            if _is_root_json_entry(normalized_name)
        ]
        if len(json_entries) != 1:
            raise ValueError("Import ZIP must contain exactly one JSON file at the archive root.")

        try:
            json_payload = _read_zip_member_bytes(
                archive=archive,
                member=json_entries[0],
                max_size=container.settings.bundle_import_json_max_bytes,
                too_large_message=(
                    "Import ZIP JSON file exceeds maximum size "
                    f"({container.settings.bundle_import_json_max_bytes} bytes)."
                ),
            )
            parsed = json.loads(json_payload.decode("utf-8"))
        except UnicodeDecodeError as err:
            raise ValueError("Import ZIP JSON file must be UTF-8 encoded.") from err
        except json.JSONDecodeError as err:
            raise ValueError(f"Import ZIP JSON could not be parsed: {err.msg}") from err

        referenced_names = _collect_referenced_gen_audio_stored_names_from_payload(parsed)
        if not referenced_names:
            return parsed

        for stored_name in sorted(referenced_names):
            expected_member_name = f"audio/{stored_name}"
            member = member_by_normalized_name.get(expected_member_name)
            if member is None:
                raise ValueError(
                    f"Import ZIP is missing referenced GEN audio asset 'audio/{stored_name}'."
                )
            container.gen_asset_service.import_audio_chunks_with_stored_name(
                stored_name=stored_name,
                chunks=_iter_zip_member_chunks(
                    archive=archive,
                    member=member,
                    max_size=container.gen_asset_service.max_audio_asset_bytes,
                    too_large_message=(
                        "Audio import payload exceeds maximum size "
                        f"({container.gen_asset_service.max_audio_asset_bytes} bytes)."
                    ),
                ),
                original_name=stored_name,
            )

        return parsed


def _reject_declared_oversized_import(*, content_length: str | None, max_size: int) -> None:
    if content_length is None:
        return
    try:
        declared_size = int(content_length)
    except ValueError:
        return
    if declared_size > max_size:
        raise HTTPException(
            status_code=413,
            detail=f"Bundle import exceeds maximum request size ({max_size} bytes).",
        )


async def _read_limited_import_body(*, request: Request, max_size: int) -> BinaryIO:
    payload_file = SpooledTemporaryFile(max_size=min(max_size, _IMPORT_READ_CHUNK_BYTES), mode="w+b")
    size = 0
    try:
        async for chunk in request.stream():
            if not chunk:
                continue
            next_size = size + len(chunk)
            if next_size > max_size:
                raise ImportBundleTooLargeError(
                    f"Bundle import exceeds maximum request size ({max_size} bytes)."
                )
            payload_file.write(chunk)
            size = next_size
        if size <= 0:
            raise ValueError("Import file is empty.")
        payload_file.seek(0)
        return payload_file
    except Exception:
        payload_file.close()
        raise


def _validate_zip_import_metadata(
    *,
    archive: zipfile.ZipFile,
    container: AppContainer,
) -> dict[str, zipfile.ZipInfo]:
    entries = archive.infolist()
    if len(entries) > container.settings.bundle_import_zip_max_members:
        raise ImportBundleTooLargeError(
            "Import ZIP contains too many members "
            f"({container.settings.bundle_import_zip_max_members} maximum)."
        )

    total_uncompressed_size = 0
    member_by_normalized_name: dict[str, zipfile.ZipInfo] = {}
    for member in entries:
        normalized_name = _normalize_zip_member_name(member.filename)
        if not normalized_name:
            raise ValueError("Import ZIP contains an invalid member path.")
        if member.flag_bits & 0x1:
            raise ValueError("Import ZIP contains encrypted members, which are not supported.")

        total_uncompressed_size += member.file_size
        if total_uncompressed_size > container.settings.bundle_import_zip_max_uncompressed_bytes:
            raise ImportBundleTooLargeError(
                "Import ZIP exceeds maximum total uncompressed size "
                f"({container.settings.bundle_import_zip_max_uncompressed_bytes} bytes)."
            )

        if member.is_dir():
            continue
        if normalized_name in member_by_normalized_name:
            raise ValueError("Import ZIP contains duplicate member paths.")
        if (
            _is_root_json_entry(normalized_name)
            and member.file_size > container.settings.bundle_import_json_max_bytes
        ):
            raise ImportBundleTooLargeError(
                "Import ZIP JSON file exceeds maximum size "
                f"({container.settings.bundle_import_json_max_bytes} bytes)."
            )
        if (
            normalized_name.startswith("audio/")
            and member.file_size > container.gen_asset_service.max_audio_asset_bytes
        ):
            raise ImportBundleTooLargeError(
                "Audio import payload exceeds maximum size "
                f"({container.gen_asset_service.max_audio_asset_bytes} bytes)."
            )
        member_by_normalized_name[normalized_name] = member

    return member_by_normalized_name


def _read_limited_file_bytes(
    file_obj: BinaryIO,
    *,
    max_size: int,
    too_large_message: str,
) -> bytes:
    chunks: list[bytes] = []
    size = 0
    while True:
        chunk = file_obj.read(_IMPORT_READ_CHUNK_BYTES)
        if not chunk:
            break
        size += len(chunk)
        if size > max_size:
            raise ImportBundleTooLargeError(too_large_message)
        chunks.append(chunk)
    return b"".join(chunks)


def _read_zip_member_bytes(
    *,
    archive: zipfile.ZipFile,
    member: zipfile.ZipInfo,
    max_size: int,
    too_large_message: str,
) -> bytes:
    return b"".join(
        _iter_zip_member_chunks(
            archive=archive,
            member=member,
            max_size=max_size,
            too_large_message=too_large_message,
        )
    )


def _iter_zip_member_chunks(
    *,
    archive: zipfile.ZipFile,
    member: zipfile.ZipInfo,
    max_size: int,
    too_large_message: str,
):
    size = 0
    try:
        with archive.open(member, "r") as source:
            while True:
                chunk = source.read(_IMPORT_READ_CHUNK_BYTES)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_size:
                    raise ImportBundleTooLargeError(too_large_message)
                yield chunk
    except NotImplementedError as err:
        raise ValueError("Import ZIP uses an unsupported compression method.") from err
    except RuntimeError as err:
        raise ValueError("Import ZIP member could not be read.") from err
    except zipfile.BadZipFile as err:
        raise ValueError("Import ZIP member is invalid.") from err


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


def _looks_like_zip(*, prefix: bytes, filename: str | None) -> bool:
    if any(prefix.startswith(candidate) for candidate in _ZIP_MAGIC_PREFIXES):
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
