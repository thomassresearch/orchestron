"""Yamaha DX7 VCED (one voice) and VMEM (32-voice cartridge) dumps."""

from base64 import b64decode, b64encode
from binascii import Error
from functools import cached_property
from hashlib import sha256
import json
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

DATA = Path(__file__).resolve().parents[1] / "data"
DX7 = json.loads((DATA / "dx7.json").read_text())

# Some Dexed cartridges store fine tuning above the panel's 99. All seven
# bits are safe in the frequency formula and survive a save/load unchanged.
OP_MAX = tuple(DX7["operatorMax"])
VOICE_MAX = OP_MAX * 6 + (99,) * 8 + (31, 7, 1, 99, 99, 99, 99, 1, 5, 7, 48) + (127,) * 10
MAX_DUMP_BYTES = 4104

# Operators are stored in Yamaha wire order, OP6 first. One audible carrier.
INIT_VOICE = b64decode(DX7["initialVoice"])
DX7_PREVIEW_KEYS = tuple(f"dx7_{i}" for i in range(145))
DX7_PREVIEW_LIMITS = dict(zip(DX7_PREVIEW_KEYS, VOICE_MAX[:145], strict=True))


def validate_voice(data: bytes) -> bytes:
    if len(data) != 155 or any(v > m for v, m in zip(data, VOICE_MAX, strict=True)):
        raise ValueError("Invalid DX7 voice length or parameter value.")
    return data


def node_voice(params: dict, key: str = "voice") -> bytes:
    if key not in params:
        return INIT_VOICE
    value = params[key]
    if not isinstance(value, str) or len(value) != 208:
        raise ValueError("Expected a 155-byte base64 DX7 voice.")
    try:
        return validate_voice(b64decode(value, validate=True))
    except (Error, ValueError) as exc:
        raise ValueError("Invalid DX7 voice data.") from exc


DX7_PRESETS = {
    preset["id"]: node_voice(preset)[:145]
    for preset in json.loads((DATA / "dx7-presets.json").read_text())["presets"]
}


def validate_preset_input(value: str | int | float | bool) -> None:
    if isinstance(value, str):
        try:
            value = float(value)
        except ValueError:
            return  # The graph compiler resolves scalar expressions.
    if isinstance(value, bool) or value not in range(len(DX7_PRESETS) + 1):
        raise ValueError(f"DX7 ipreset must be a whole number in 0..{len(DX7_PRESETS)}.")


def validate_max_release(value: str | int | float | bool) -> None:
    if isinstance(value, str):
        try:
            value = float(value)
        except ValueError:
            return  # Scalar expressions are resolved by the compiler.
    if isinstance(value, bool) or not (value == 0 or 1 <= value <= 120):
        raise ValueError("DX7 imaxrelease must be 0 (native) or 1–120 seconds.")


def _unpack(data: bytes) -> bytes:
    voice = bytearray()
    for offset in range(0, 102, 17):
        op = data[offset : offset + 17]
        voice.extend(op[:11])
        voice.extend(
            (
                op[11] & 3,
                (op[11] >> 2) & 3,
                op[12] & 7,
                op[13] & 3,
                (op[13] >> 2) & 7,
                op[14],
                op[15] & 1,
                (op[15] >> 1) & 31,
                op[16],
                op[12] >> 3,
            )
        )
    voice.extend(data[102:111])
    voice.extend((data[111] & 7, (data[111] >> 3) & 1))
    voice.extend(data[112:116])
    voice.extend((data[116] & 1, (data[116] >> 1) & 7, data[116] >> 4))
    voice.extend(data[117:])
    return bytes(voice)


def read_sysex(dump: bytes) -> list[bytes]:
    if (
        len(dump) not in (163, MAX_DUMP_BYTES)
        or dump[:2] != b"\xf0\x43"
        or dump[2] > 15
        or dump[-1] != 0xF7
        or any(v > 127 for v in dump[3:-1])
    ):
        raise ValueError("Expected a Yamaha DX7 single-voice or 32-voice SysEx dump.")
    data = dump[6:-2]
    if dump[3:6] != (b"\x00\x01\x1b" if len(data) == 155 else b"\x09\x20\x00"):
        raise ValueError("Unsupported DX7 dump type or byte count.")
    if (sum(data) + dump[-2]) % 128:
        raise ValueError("Invalid DX7 SysEx checksum.")
    if len(data) == 155:
        return [validate_voice(data)]
    return [validate_voice(_unpack(data[i : i + 128])) for i in range(0, 4096, 128)]


def describe_voice(data: bytes) -> dict[str, str | int]:
    name = "".join(chr(v) if 32 <= v < 127 else " " for v in data[145:]).strip()
    return {"name": name, "algorithm": data[134] + 1, "voice": b64encode(data).decode("ascii")}


class Dx7Cartridge(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    name: str = Field(min_length=1, max_length=255)
    data: str = Field(min_length=5472, max_length=5472)

    @field_validator("name")
    @classmethod
    def validate_name(cls, name):
        if any(ord(char) < 32 or char in "/\\\x7f" for char in name):
            raise ValueError("Invalid DX7 cartridge filename.")
        return name

    @field_validator("data")
    @classmethod
    def validate_dump(cls, value):
        raw = b64decode(value, validate=True)
        if len(raw) != MAX_DUMP_BYTES:
            raise ValueError("Expected a complete 32-voice DX7 bank.")
        read_sysex(raw)
        return value

    @cached_property
    def raw(self) -> bytes:
        return b64decode(self.data)

    @cached_property
    def digest(self) -> str:
        return sha256(self.raw).hexdigest()


Dx7Banks = Annotated[dict[Annotated[str, StringConstraints(pattern=r"^(?:[1-9]|1[0-6])$")], Dx7Cartridge],
                     Field(max_length=16)]
