from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import re
import shutil
from uuid import uuid4


MAX_GEN_AUDIO_ASSET_BYTES = 64 * 1024 * 1024
GEN01_NUMERIC_FILECODE_MIN = 1000
GEN01_NUMERIC_FILECODE_RANGE = 2_000_000_000


@dataclass(slots=True)
class StoredGenAudioAsset:
    asset_id: str
    original_name: str
    stored_name: str
    content_type: str
    size_bytes: int


class GenAssetService:
    def __init__(self, audio_dir: Path) -> None:
        self._audio_dir = Path(audio_dir)
        self._audio_dir.mkdir(parents=True, exist_ok=True)

    @property
    def audio_dir(self) -> Path:
        return self._audio_dir

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
        if size > MAX_GEN_AUDIO_ASSET_BYTES:
            raise ValueError(
                f"Audio upload exceeds maximum size ({MAX_GEN_AUDIO_ASSET_BYTES} bytes)."
            )

        original_name = self._sanitize_original_name(filename or "upload.bin")
        extension = self._safe_extension(original_name)
        asset_id = str(uuid4())
        stored_name = f"{asset_id}{extension}"
        target_path = self._audio_dir / stored_name
        target_path.write_bytes(payload)

        normalized_content_type = (content_type or "application/octet-stream").strip()
        if not normalized_content_type:
            normalized_content_type = "application/octet-stream"

        return StoredGenAudioAsset(
            asset_id=asset_id,
            original_name=original_name,
            stored_name=stored_name,
            content_type=normalized_content_type,
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
        if size > MAX_GEN_AUDIO_ASSET_BYTES:
            raise ValueError(
                f"Audio import payload exceeds maximum size ({MAX_GEN_AUDIO_ASSET_BYTES} bytes)."
            )

        validated_stored_name = self._validate_stored_name(stored_name)
        target_path = self._audio_dir / validated_stored_name
        if target_path.exists():
            existing = target_path.read_bytes()
            if existing != payload:
                raise ValueError(
                    f"Audio asset '{validated_stored_name}' already exists with different content."
                )
        else:
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
        return candidate
