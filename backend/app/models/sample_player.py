"""Authored sample maps and immutable media references shared by all boundaries."""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

SAMPLE_RATE = 48_000
MAX_SAMPLE_SECONDS = 120
MAX_SAMPLE_MANIFEST = 2_048
MAX_SAMPLE_TABLE_BYTES = 256 * 1024 * 1024
MAX_SAMPLE_INSTANCE_VOICES = 64
MAX_SAMPLE_VOICES = 256
SAMPLE_BINDING_COMMENT = "; vcs_sample_binding_v1 "

Digest = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
AssetId = Annotated[str, StringConstraints(pattern=r"^[0-9a-zA-Z_-]{1,128}$")]
StoredName = Annotated[str, StringConstraints(pattern=r"^sam-[0-9a-f]{64}\.(wav|mp3|m4a)$")]


class _SampleModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class SampleFile(_SampleModel):
    stored_name: StoredName
    sha256: Digest
    size_bytes: int = Field(gt=0)

    @model_validator(mode="after")
    def verify_name(self):
        if self.stored_name.split(".")[0] != f"sam-{self.sha256}":
            raise ValueError("Sample filename does not match its content identity.")
        return self


class SampleSource(SampleFile):
    original_name: str = Field(min_length=1, max_length=255)
    format: Literal["wav", "mp3", "m4a"]

    @model_validator(mode="after")
    def verify_source(self):
        if not self.stored_name.endswith("." + self.format) or any(c in self.original_name for c in "/\\\x00"):
            raise ValueError("Invalid sample source name or format.")
        return self


class SamplePlayback(SampleFile):
    sample_rate: Literal[48000] = Field(alias="sampleRate")
    channels: Literal[1, 2]
    frame_count: int = Field(alias="frameCount", ge=1, le=SAMPLE_RATE * MAX_SAMPLE_SECONDS)
    format: Literal["wav-f32le"]

    @field_validator("sample_rate", "channels", mode="before")
    @classmethod
    def require_integer(cls, value):
        if type(value) is not int:
            raise ValueError("Sample rate and channel count must be integers.")
        return value

    @model_validator(mode="after")
    def verify_playback(self):
        if not self.stored_name.endswith(".wav"):
            raise ValueError("Invalid sample playback format.")
        return self


class SampleAsset(_SampleModel):
    source: SampleSource
    playback: SamplePlayback
    decoder_revision: str = Field(alias="decoderRevision", min_length=1, max_length=128)


class SampleUpload(_SampleModel):
    asset_id: AssetId
    asset: SampleAsset


class SampleEntry(_SampleModel):
    note: int = Field(ge=0, le=127)
    asset_id: AssetId = Field(alias="assetId")


class SampleMap(_SampleModel):
    version: Literal[1]
    entries: list[SampleEntry] = Field(max_length=128)

    @field_validator("version", mode="before")
    @classmethod
    def require_version_integer(cls, value):
        if type(value) is not int:
            raise ValueError("Sample map version must be an integer.")
        return value

    @model_validator(mode="after")
    def canonical_order(self):
        if len({entry.note for entry in self.entries}) != len(self.entries):
            raise ValueError("Sample maps require version 1 and unique MIDI notes.")
        self.entries.sort(key=lambda entry: entry.note)
        return self


SampleAssets = Annotated[dict[AssetId, SampleAsset], Field(max_length=MAX_SAMPLE_MANIFEST)]


def resolve_sample_manifest(maps, assets: SampleAssets) -> SampleAssets:
    used = {entry.asset_id for mapping in maps if mapping is not None for entry in mapping.entries}
    missing = used - assets.keys()
    if missing:
        raise ValueError(f"Missing sample asset: {min(missing)}.")
    return {key: assets[key] for key in sorted(used)}


def sample_asset_id(asset: SampleAsset) -> str:
    import hashlib
    return hashlib.sha256(f"{asset.source.sha256}:{asset.playback.sha256}".encode()).hexdigest()


def validate_authored_samples(value, *, recovery: bool = False):
    if not isinstance(value, dict):
        return value
    version = value.get("version")
    maximum = 9 if recovery else 27
    if version is not None and (type(version) is not int or not 1 <= version <= maximum):
        raise ValueError("Unsupported application state or performance version.")
    # Recovery flattens the current rack into the app-state snapshot.
    raw_instruments = value.get("instruments" if not recovery else "sequencerInstruments", [])
    if not isinstance(raw_instruments, list):
        raw_instruments = []
    has_sample_data = "sampleAssets" in value or any(isinstance(i, dict) and "sampleMap" in i for i in raw_instruments)
    if not has_sample_data:
        return value
    if version != maximum:
        raise ValueError(f"Sample maps require format version {maximum}.")
    from pydantic import TypeAdapter
    if len(raw_instruments) > 64:
        raise ValueError("Too many instrument assignments.")
    manifest = TypeAdapter(SampleAssets).validate_python(value.get("sampleAssets", {}))
    instruments = []
    maps = []
    for instrument in raw_instruments:
        if isinstance(instrument, dict) and "sampleMap" in instrument:
            mapping = SampleMap.model_validate(instrument["sampleMap"])
            maps.append(mapping)
            instrument = {**instrument, "sampleMap": mapping.model_dump(by_alias=True)}
        instruments.append(instrument)
    assets = resolve_sample_manifest(maps, manifest)
    return {**value, ("sequencerInstruments" if recovery else "instruments"): instruments,
            "sampleAssets": {key: asset.model_dump(by_alias=True) for key, asset in assets.items()}}
