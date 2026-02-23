from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from uuid import uuid4


MAX_GEN_AUDIO_ASSET_BYTES = 64 * 1024 * 1024


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
        candidate = stored_name.strip()
        if not candidate:
            raise ValueError("Missing stored audio asset name.")
        if "/" in candidate or "\\" in candidate:
            raise ValueError("Invalid stored audio asset name.")

        resolved = (self._audio_dir / candidate).resolve()
        try:
            resolved.relative_to(self._audio_dir.resolve())
        except ValueError as err:
            raise ValueError("Audio asset path escapes configured asset directory.") from err
        return resolved

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

