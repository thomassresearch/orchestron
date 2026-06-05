from __future__ import annotations

from collections.abc import AsyncIterable, Callable, Iterable
from dataclasses import dataclass
import filecmp
import hashlib
import os
from pathlib import Path
import re
import shutil
import threading
import time
from uuid import uuid4


MAX_GEN_AUDIO_ASSET_BYTES = 64 * 1024 * 1024
MAX_GEN_AUDIO_ASSETS_TOTAL_BYTES = 1024 * 1024 * 1024
MAX_GEN_AUDIO_ASSETS_COUNT = 1024
GEN_AUDIO_ASSET_GC_MIN_AGE_SECONDS = 24 * 60 * 60
GEN01_NUMERIC_FILECODE_MIN = 1000
GEN01_NUMERIC_FILECODE_RANGE = 2_000_000_000


@dataclass(slots=True)
class StoredGenAudioAsset:
    asset_id: str
    original_name: str
    stored_name: str
    content_type: str
    size_bytes: int


class GenAudioAssetTooLargeError(ValueError):
    pass


class GenAudioAssetQuotaExceededError(ValueError):
    pass


@dataclass(slots=True)
class GenAudioAssetStorageStats:
    primary_asset_count: int
    total_bytes: int


class GenAssetService:
    def __init__(
        self,
        audio_dir: Path,
        *,
        max_audio_asset_bytes: int = MAX_GEN_AUDIO_ASSET_BYTES,
        max_audio_assets_total_bytes: int = MAX_GEN_AUDIO_ASSETS_TOTAL_BYTES,
        max_audio_assets_count: int = MAX_GEN_AUDIO_ASSETS_COUNT,
        gc_min_age_seconds: float = GEN_AUDIO_ASSET_GC_MIN_AGE_SECONDS,
    ) -> None:
        self._audio_dir = Path(audio_dir)
        self._audio_dir.mkdir(parents=True, exist_ok=True)
        self._max_audio_asset_bytes = max(1, int(max_audio_asset_bytes))
        self._max_audio_assets_total_bytes = max(1, int(max_audio_assets_total_bytes))
        self._max_audio_assets_count = max(1, int(max_audio_assets_count))
        self._gc_min_age_seconds = max(0.0, float(gc_min_age_seconds))
        self._quota_lock = threading.RLock()

    @property
    def audio_dir(self) -> Path:
        return self._audio_dir

    @property
    def max_audio_asset_bytes(self) -> int:
        return self._max_audio_asset_bytes

    @property
    def max_audio_assets_total_bytes(self) -> int:
        return self._max_audio_assets_total_bytes

    @property
    def max_audio_assets_count(self) -> int:
        return self._max_audio_assets_count

    @property
    def gc_min_age_seconds(self) -> float:
        return self._gc_min_age_seconds

    def storage_stats(self) -> GenAudioAssetStorageStats:
        with self._quota_lock:
            return self._storage_stats_unlocked()

    def assert_upload_can_fit_declared_size(self, size: int) -> None:
        if size <= 0:
            return
        self._raise_if_upload_exceeds_max(size)
        with self._quota_lock:
            self._raise_if_new_assets_exceed_quota_unlocked(1, size, action="Audio upload")

    def assert_new_audio_assets_can_fit(
        self,
        *,
        asset_count: int,
        total_bytes: int,
        action: str,
    ) -> None:
        if asset_count <= 0 and total_bytes <= 0:
            return
        with self._quota_lock:
            self._raise_if_new_assets_exceed_quota_unlocked(asset_count, total_bytes, action=action)

    def store_audio_bytes(
        self,
        *,
        filename: str | None,
        content_type: str | None,
        payload: bytes,
    ) -> StoredGenAudioAsset:
        size = len(payload)
        if size <= 0:
            raise ValueError("Audio upload is empty.")
        self._raise_if_upload_exceeds_max(size)

        original_name = self._sanitize_original_name(filename or "upload.bin")
        extension = self._safe_extension(original_name)
        asset_id = str(uuid4())
        stored_name = f"{asset_id}{extension}"
        target_path = self._audio_dir / stored_name
        with self._quota_lock:
            self._raise_if_new_assets_exceed_quota_unlocked(1, size, action="Audio upload")
            target_path.write_bytes(payload)

        return StoredGenAudioAsset(
            asset_id=asset_id,
            original_name=original_name,
            stored_name=stored_name,
            content_type=self._normalize_content_type(content_type),
            size_bytes=size,
        )

    async def store_audio_stream(
        self,
        *,
        filename: str | None,
        content_type: str | None,
        chunks: AsyncIterable[bytes],
        quota_retry: Callable[[], None] | None = None,
    ) -> StoredGenAudioAsset:
        original_name = self._sanitize_original_name(filename or "upload.bin")
        extension = self._safe_extension(original_name)
        asset_id = str(uuid4())
        stored_name = f"{asset_id}{extension}"
        target_path = self._audio_dir / stored_name
        temp_path = self._audio_dir / f".{stored_name}.upload"
        size = 0

        try:
            with temp_path.open("wb") as output:
                async for chunk in chunks:
                    if not chunk:
                        continue
                    next_size = size + len(chunk)
                    self._raise_if_upload_exceeds_max(next_size)
                    output.write(chunk)
                    size = next_size

            if size <= 0:
                raise ValueError("Audio upload is empty.")

            with self._quota_lock:
                try:
                    self._raise_if_new_assets_exceed_quota_unlocked(1, size, action="Audio upload")
                except GenAudioAssetQuotaExceededError:
                    if quota_retry is None:
                        raise
                    quota_retry()
                    self._raise_if_new_assets_exceed_quota_unlocked(1, size, action="Audio upload")
                os.replace(temp_path, target_path)
        except Exception:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

        return StoredGenAudioAsset(
            asset_id=asset_id,
            original_name=original_name,
            stored_name=stored_name,
            content_type=self._normalize_content_type(content_type),
            size_bytes=size,
        )

    def resolve_audio_path(self, stored_name: str) -> Path:
        candidate = self._validate_stored_name(stored_name)

        resolved = (self._audio_dir / candidate).resolve()
        try:
            resolved.relative_to(self._audio_dir.resolve())
        except ValueError as err:
            raise ValueError("Audio asset path escapes configured asset directory.") from err
        return resolved

    def import_audio_bytes_with_stored_name(
        self,
        *,
        stored_name: str,
        payload: bytes,
        content_type: str | None = None,
        original_name: str | None = None,
    ) -> StoredGenAudioAsset:
        size = len(payload)
        if size <= 0:
            raise ValueError("Audio import payload is empty.")
        if size > self._max_audio_asset_bytes:
            raise ValueError(
                f"Audio import payload exceeds maximum size ({self._max_audio_asset_bytes} bytes)."
            )

        validated_stored_name = self._validate_stored_name(stored_name)
        target_path = self._audio_dir / validated_stored_name
        with self._quota_lock:
            if target_path.exists():
                existing = target_path.read_bytes()
                if existing != payload:
                    raise ValueError(
                        f"Audio asset '{validated_stored_name}' already exists with different content."
                    )
            else:
                self._raise_if_new_assets_exceed_quota_unlocked(1, size, action="Audio import")
                target_path.write_bytes(payload)

        normalized_content_type = (content_type or "application/octet-stream").strip() or "application/octet-stream"
        normalized_original_name = self._sanitize_original_name(original_name or validated_stored_name)
        inferred_asset_id = Path(validated_stored_name).stem or str(uuid4())
        return StoredGenAudioAsset(
            asset_id=inferred_asset_id,
            original_name=normalized_original_name,
            stored_name=validated_stored_name,
            content_type=normalized_content_type,
            size_bytes=size,
        )

    def import_audio_chunks_with_stored_name(
        self,
        *,
        stored_name: str,
        chunks: Iterable[bytes],
        content_type: str | None = None,
        original_name: str | None = None,
    ) -> StoredGenAudioAsset:
        validated_stored_name = self._validate_stored_name(stored_name)
        target_path = self._audio_dir / validated_stored_name
        temp_path = self._audio_dir / f".{validated_stored_name}.{uuid4()}.import"
        size = 0

        try:
            with temp_path.open("wb") as output:
                for chunk in chunks:
                    if not chunk:
                        continue
                    next_size = size + len(chunk)
                    if next_size > self._max_audio_asset_bytes:
                        raise ValueError(
                            f"Audio import payload exceeds maximum size ({self._max_audio_asset_bytes} bytes)."
                        )
                    output.write(chunk)
                    size = next_size

            if size <= 0:
                raise ValueError("Audio import payload is empty.")

            with self._quota_lock:
                if target_path.exists():
                    if not filecmp.cmp(target_path, temp_path, shallow=False):
                        raise ValueError(
                            f"Audio asset '{validated_stored_name}' already exists with different content."
                        )
                    temp_path.unlink(missing_ok=True)
                else:
                    self._raise_if_new_assets_exceed_quota_unlocked(1, size, action="Audio import")
                    os.replace(temp_path, target_path)
        except Exception:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

        normalized_content_type = (content_type or "application/octet-stream").strip() or "application/octet-stream"
        normalized_original_name = self._sanitize_original_name(original_name or validated_stored_name)
        inferred_asset_id = Path(validated_stored_name).stem or str(uuid4())
        return StoredGenAudioAsset(
            asset_id=inferred_asset_id,
            original_name=normalized_original_name,
            stored_name=validated_stored_name,
            content_type=normalized_content_type,
            size_bytes=size,
        )

    def ensure_gen01_numeric_filecode_alias(self, stored_name: str) -> int:
        source_path = self.resolve_audio_path(stored_name)
        base_code = self._stable_gen01_numeric_filecode(stored_name)
        for offset in range(64):
            filecode = GEN01_NUMERIC_FILECODE_MIN + ((base_code + offset) % GEN01_NUMERIC_FILECODE_RANGE)
            alias_path = self._audio_dir / f"soundin.{filecode}"
            if alias_path.exists():
                try:
                    if alias_path.samefile(source_path):
                        return filecode
                except OSError:
                    pass
                continue

            self._create_gen01_alias(alias_path, source_path)
            return filecode

        raise ValueError("Unable to allocate a GEN01 numeric alias for uploaded audio asset.")

    def garbage_collect_unreferenced_assets(
        self,
        *,
        referenced_stored_names: Iterable[str],
        min_age_seconds: float | None = None,
    ) -> int:
        referenced = {
            self._validate_stored_name(stored_name)
            for stored_name in referenced_stored_names
            if stored_name and stored_name.strip()
        }
        cutoff = time.time() - (self._gc_min_age_seconds if min_age_seconds is None else max(0.0, min_age_seconds))
        removed = 0
        with self._quota_lock:
            for path in self._iter_audio_dir_entries():
                if self._is_temp_asset_path(path):
                    if self._path_mtime(path) <= cutoff:
                        removed += self._unlink_path(path)
                    continue
                if self._is_gen01_alias_name(path.name):
                    removed += self._unlink_path(path)
                    continue
                if path.name in referenced:
                    continue
                if self._path_mtime(path) <= cutoff:
                    removed += self._unlink_path(path)
        return removed

    @staticmethod
    def _stable_gen01_numeric_filecode(stored_name: str) -> int:
        digest = hashlib.blake2s(stored_name.encode("utf-8"), digest_size=8).digest()
        return int.from_bytes(digest, byteorder="big", signed=False)

    @staticmethod
    def _create_gen01_alias(alias_path: Path, source_path: Path) -> None:
        try:
            os.link(source_path, alias_path)
            return
        except OSError:
            pass

        try:
            alias_path.symlink_to(source_path.name)
            return
        except OSError:
            pass

        shutil.copy2(source_path, alias_path)

    @staticmethod
    def _sanitize_original_name(filename: str) -> str:
        raw = Path(filename).name.strip()
        if not raw:
            return "upload.bin"
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", raw)
        safe = safe.strip("._")
        return safe or "upload.bin"

    @staticmethod
    def _safe_extension(filename: str) -> str:
        suffix = Path(filename).suffix.lower()
        if not suffix:
            return ".bin"
        if not re.fullmatch(r"\.[a-z0-9]{1,10}", suffix):
            return ".bin"
        return suffix

    @staticmethod
    def _validate_stored_name(stored_name: str) -> str:
        candidate = stored_name.strip()
        if not candidate:
            raise ValueError("Missing stored audio asset name.")
        if "/" in candidate or "\\" in candidate:
            raise ValueError("Invalid stored audio asset name.")
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,255}", candidate):
            raise ValueError("Invalid stored audio asset name.")
        if re.fullmatch(r"soundin\.\d+", candidate):
            raise ValueError("Invalid stored audio asset name.")
        return candidate

    def _raise_if_upload_exceeds_max(self, size: int) -> None:
        if size > self._max_audio_asset_bytes:
            raise GenAudioAssetTooLargeError(
                f"Audio upload exceeds maximum size ({self._max_audio_asset_bytes} bytes)."
            )

    def _raise_if_new_assets_exceed_quota_unlocked(
        self,
        asset_count: int,
        total_bytes: int,
        *,
        action: str,
    ) -> None:
        stats = self._storage_stats_unlocked()
        if stats.primary_asset_count + asset_count > self._max_audio_assets_count:
            raise GenAudioAssetQuotaExceededError(
                f"{action} would exceed generated audio asset count quota "
                f"({self._max_audio_assets_count} assets)."
            )
        if stats.total_bytes + total_bytes > self._max_audio_assets_total_bytes:
            raise GenAudioAssetQuotaExceededError(
                f"{action} would exceed generated audio asset storage quota "
                f"({self._max_audio_assets_total_bytes} bytes)."
            )

    def _storage_stats_unlocked(self) -> GenAudioAssetStorageStats:
        primary_count = 0
        total_bytes = 0
        counted_inodes: set[tuple[int, int]] = set()
        for path in self._iter_audio_dir_entries():
            if self._is_temp_asset_path(path):
                continue
            try:
                stat_result = path.stat(follow_symlinks=False)
            except OSError:
                continue
            if not self._is_gen01_alias_name(path.name):
                primary_count += 1
            inode_key = (stat_result.st_dev, stat_result.st_ino)
            if inode_key in counted_inodes:
                continue
            counted_inodes.add(inode_key)
            total_bytes += stat_result.st_size
        return GenAudioAssetStorageStats(primary_asset_count=primary_count, total_bytes=total_bytes)

    def _iter_audio_dir_entries(self) -> list[Path]:
        try:
            return [path for path in self._audio_dir.iterdir() if not path.is_dir()]
        except FileNotFoundError:
            self._audio_dir.mkdir(parents=True, exist_ok=True)
            return []

    @staticmethod
    def _is_temp_asset_path(path: Path) -> bool:
        return path.name.startswith(".") and (path.name.endswith(".upload") or ".import" in path.name)

    @staticmethod
    def _is_gen01_alias_name(name: str) -> bool:
        return re.fullmatch(r"soundin\.\d+", name) is not None

    @staticmethod
    def _path_mtime(path: Path) -> float:
        try:
            return path.stat(follow_symlinks=False).st_mtime
        except OSError:
            return 0.0

    @staticmethod
    def _unlink_path(path: Path) -> int:
        try:
            path.unlink(missing_ok=True)
            return 1
        except OSError:
            return 0

    @staticmethod
    def _normalize_content_type(content_type: str | None) -> str:
        return (content_type or "application/octet-stream").strip() or "application/octet-stream"
