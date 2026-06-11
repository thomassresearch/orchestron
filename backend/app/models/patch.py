from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator

from backend.app.models.opcode import SignalType
from backend.app.models.source_text import reject_control_characters

PatchParam = str | int | float | bool

AUDIO_RATE_MIN = 22_000
AUDIO_RATE_MAX = 48_000
CONTROL_RATE_MIN = 25
CONTROL_RATE_MAX = 48_000
BUFFER_SIZE_MIN = 32
BUFFER_SIZE_MAX = 8_192
GEN_NODES_LAYOUT_KEY = "gen_nodes"
DEFAULT_GEN_TABLE_SIZE = 16_384
MAX_GEN_TABLE_SIZE = 4_194_304
MAX_GEN_ARGUMENT_COUNT = 512
MAX_GEN_RAW_ARGS_TEXT_LENGTH = 8_192
MAX_GEN_RAW_ARG_TOKEN_LENGTH = 512


def _gen_number(value: object, *, default: float | int | None) -> float | int | None:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int | float):
        if isinstance(value, float) and not (value == value and abs(value) != float("inf")):
            return default
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return default
        try:
            if re.fullmatch(r"[-+]?\d+", text):
                return int(text)
            if re.fullmatch(r"[-+]?(?:\d+\.?\d*|\.\d+)", text):
                return float(text)
        except ValueError:
            return default
    return default


def _gen_int(value: object, *, default: int) -> int:
    number = _gen_number(value, default=None)
    if number is None:
        return default
    return int(round(number))


def _gen_bool(value: object, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int | float):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return default


def _gen_number_list(value: object) -> list[int | float]:
    if not isinstance(value, list):
        return []
    result: list[int | float] = []
    for entry in value:
        number = _gen_number(entry, default=None)
        if number is not None:
            result.append(number)
    return result


def _limited_number_list(value: object) -> list[int | float]:
    if isinstance(value, list) and len(value) > MAX_GEN_ARGUMENT_COUNT:
        raise ValueError(f"GEN argument lists cannot exceed {MAX_GEN_ARGUMENT_COUNT} entries.")
    return _gen_number_list(value)


class NodePortRef(BaseModel):
    id: str = Field(min_length=1)
    signal_type: SignalType


class NodePosition(BaseModel):
    x: float = 0.0
    y: float = 0.0


class NodeInstance(BaseModel):
    id: str = Field(min_length=1)
    opcode: str = Field(min_length=1)
    params: dict[str, PatchParam] = Field(default_factory=dict)
    position: NodePosition = Field(default_factory=NodePosition)

    @field_validator("id")
    @classmethod
    def validate_id_text(cls, value: str) -> str:
        return reject_control_characters(value, field_name="Node ID")


class Connection(BaseModel):
    from_node_id: str = Field(min_length=1)
    from_port_id: str = Field(min_length=1)
    to_node_id: str = Field(min_length=1)
    to_port_id: str = Field(min_length=1)

    @field_validator("from_node_id", "to_node_id")
    @classmethod
    def validate_node_ref_text(cls, value: str) -> str:
        return reject_control_characters(value, field_name="Connection node ID")


class GenSegmentPoint(BaseModel):
    length: float | int
    value: float | int

    @field_validator("length", "value", mode="before")
    @classmethod
    def coerce_number(cls, value: object) -> float | int:
        number = _gen_number(value, default=None)
        if number is None:
            raise ValueError("GEN segment points require numeric length and value fields.")
        return number


class GenXYPoint(BaseModel):
    x: float | int
    y: float | int

    @field_validator("x", "y", mode="before")
    @classmethod
    def coerce_number(cls, value: object) -> float | int:
        number = _gen_number(value, default=None)
        if number is None:
            raise ValueError("GEN x/y points require numeric fields.")
        return number


class GenNodeConfig(BaseModel):
    mode: Literal["ftgen", "ftgenonce"] = "ftgen"
    table_number: int = Field(default=0, alias="tableNumber")
    start_time: float | int = Field(default=0, alias="startTime")
    table_size: int = Field(default=DEFAULT_GEN_TABLE_SIZE, alias="tableSize")
    routine_number: int = Field(default=10, alias="routineNumber")
    routine_name: str = Field(default="", alias="routineName", max_length=64)
    normalize: bool = True
    harmonic_amplitudes: list[int | float] = Field(default_factory=list, alias="harmonicAmplitudes")
    partials: list[int | float] = Field(default_factory=list)
    gen11_harmonic_count: int = Field(default=8, alias="gen11HarmonicCount")
    gen11_lowest_harmonic: int = Field(default=1, alias="gen11LowestHarmonic")
    gen11_multiplier: float | int = Field(default=1, alias="gen11Multiplier")
    value_list: list[int | float] = Field(default_factory=list, alias="valueList")
    values: list[int | float] = Field(default_factory=list)
    segment_start_value: float | int = Field(default=0, alias="segmentStartValue")
    segments: list[GenSegmentPoint] = Field(default_factory=list)
    gen17_pairs: list[GenXYPoint] = Field(default_factory=list, alias="gen17Pairs")
    pairs: list[GenXYPoint] = Field(default_factory=list)
    gen20_window_type: int = Field(default=1, alias="gen20WindowType")
    window_type: int = Field(default=1, alias="windowType")
    gen20_max: float | int = Field(default=1, alias="gen20Max")
    max_value: float | int = Field(default=1, alias="max")
    gen20_opt: float | int = Field(default=0.5, alias="gen20Opt")
    opt: float | int = 0.5
    sample_asset: dict[str, JsonValue] | None = Field(default=None, alias="sampleAsset")
    sample_path: str = Field(default="", alias="samplePath", max_length=512)
    sample_skip_time: float | int = Field(default=0, alias="sampleSkipTime")
    sample_format: int = Field(default=0, alias="sampleFormat")
    sample_channel: int = Field(default=0, alias="sampleChannel")
    raw_args: list[JsonValue] = Field(default_factory=list, alias="rawArgs")
    raw_args_text: str = Field(default="", alias="rawArgsText", max_length=MAX_GEN_RAW_ARGS_TEXT_LENGTH)

    model_config = ConfigDict(populate_by_name=True, extra="allow")

    @field_validator("mode", mode="before")
    @classmethod
    def coerce_mode(cls, value: object) -> str:
        if isinstance(value, str) and value.strip().lower() == "ftgenonce":
            return "ftgenonce"
        return "ftgen"

    @field_validator(
        "table_number",
        "table_size",
        "routine_number",
        "gen11_harmonic_count",
        "gen11_lowest_harmonic",
        "gen20_window_type",
        "window_type",
        "sample_format",
        "sample_channel",
        mode="before",
    )
    @classmethod
    def coerce_int(cls, value: object, info: Any) -> int:
        defaults = {
            "table_number": 0,
            "table_size": DEFAULT_GEN_TABLE_SIZE,
            "routine_number": 10,
            "gen11_harmonic_count": 8,
            "gen11_lowest_harmonic": 1,
            "gen20_window_type": 1,
            "window_type": 1,
            "sample_format": 0,
            "sample_channel": 0,
        }
        return _gen_int(value, default=defaults[info.field_name])

    @field_validator(
        "start_time",
        "gen11_multiplier",
        "segment_start_value",
        "gen20_max",
        "max_value",
        "gen20_opt",
        "opt",
        "sample_skip_time",
        mode="before",
    )
    @classmethod
    def coerce_number(cls, value: object, info: Any) -> float | int:
        defaults: dict[str, float | int] = {
            "start_time": 0,
            "gen11_multiplier": 1,
            "segment_start_value": 0,
            "gen20_max": 1,
            "max_value": 1,
            "gen20_opt": 0.5,
            "opt": 0.5,
            "sample_skip_time": 0,
        }
        number = _gen_number(value, default=defaults[info.field_name])
        return defaults[info.field_name] if number is None else number

    @field_validator("normalize", mode="before")
    @classmethod
    def coerce_bool(cls, value: object) -> bool:
        return _gen_bool(value, default=True)

    @field_validator("routine_name", mode="before")
    @classmethod
    def normalize_routine_name(cls, value: object) -> str:
        if not isinstance(value, str):
            return ""
        return value.strip().lower()

    @field_validator("harmonic_amplitudes", "partials", "value_list", "values", mode="before")
    @classmethod
    def coerce_number_list(cls, value: object) -> list[int | float]:
        return _limited_number_list(value)

    @field_validator("segments", "gen17_pairs", "pairs", mode="before")
    @classmethod
    def validate_structured_list_count(cls, value: object) -> object:
        if isinstance(value, list) and len(value) > MAX_GEN_ARGUMENT_COUNT:
            raise ValueError(f"GEN structured argument lists cannot exceed {MAX_GEN_ARGUMENT_COUNT} entries.")
        return value

    @field_validator("raw_args", mode="before")
    @classmethod
    def validate_raw_args(cls, value: object) -> list[JsonValue]:
        if value is None:
            return []
        if not isinstance(value, list):
            return []
        if len(value) > MAX_GEN_ARGUMENT_COUNT:
            raise ValueError(f"GEN rawArgs cannot exceed {MAX_GEN_ARGUMENT_COUNT} entries.")
        for entry in value:
            if isinstance(entry, str) and len(entry) > MAX_GEN_RAW_ARG_TOKEN_LENGTH:
                raise ValueError(
                    f"GEN raw argument tokens cannot exceed {MAX_GEN_RAW_ARG_TOKEN_LENGTH} characters."
                )
        return value

    @model_validator(mode="after")
    def validate_limits(self) -> "GenNodeConfig":
        self.routine_number = abs(self.routine_number)
        if self.routine_number == 0:
            self.routine_number = 10
        self.gen11_harmonic_count = max(1, self.gen11_harmonic_count)
        self.gen11_lowest_harmonic = max(1, self.gen11_lowest_harmonic)
        self.gen20_window_type = max(1, self.gen20_window_type)
        self.window_type = max(1, self.window_type)

        if self.table_size < 0:
            raise ValueError("GEN tableSize cannot be negative.")
        if self.table_size > MAX_GEN_TABLE_SIZE:
            raise ValueError(f"GEN tableSize cannot exceed {MAX_GEN_TABLE_SIZE}.")
        if self.table_size == 0 and not self.is_gen01_routine:
            routine_label = f"GEN{self.routine_name}" if self.routine_name else f"GEN{self.routine_number}"
            raise ValueError(f"GEN tableSize cannot be 0 for {routine_label}.")

        raw_tokens = self.raw_arg_tokens
        if len(raw_tokens) > MAX_GEN_ARGUMENT_COUNT:
            raise ValueError(f"GEN raw argument text cannot exceed {MAX_GEN_ARGUMENT_COUNT} tokens.")
        for token in raw_tokens:
            if len(token) > MAX_GEN_RAW_ARG_TOKEN_LENGTH:
                raise ValueError(
                    f"GEN raw argument tokens cannot exceed {MAX_GEN_RAW_ARG_TOKEN_LENGTH} characters."
                )
        return self

    @property
    def is_gen01_routine(self) -> bool:
        return self.routine_number == 1 or self.routine_name in {"1", "gen1", "gen01"}

    @property
    def raw_arg_tokens(self) -> list[str]:
        if not self.raw_args_text.strip():
            return []
        return [token.strip() for token in re.split(r"[\n,]+", self.raw_args_text) if token.strip()]


def validate_gen_node_layout_config(raw_config: object) -> GenNodeConfig:
    if not isinstance(raw_config, dict):
        raw_config = {}
    return GenNodeConfig.model_validate(raw_config)


def validate_gen_node_layout_map(ui_layout: dict[str, JsonValue]) -> None:
    raw_gen_nodes = ui_layout.get(GEN_NODES_LAYOUT_KEY)
    if raw_gen_nodes is None:
        return
    if not isinstance(raw_gen_nodes, dict):
        raise ValueError("graph.ui_layout.gen_nodes must be an object.")
    if len(raw_gen_nodes) > 500:
        raise ValueError("graph.ui_layout.gen_nodes cannot exceed 500 entries.")
    for node_id, raw_config in raw_gen_nodes.items():
        if not isinstance(node_id, str) or not node_id.strip():
            raise ValueError("graph.ui_layout.gen_nodes keys must be non-empty strings.")
        try:
            validate_gen_node_layout_config(raw_config)
        except ValueError as err:
            raise ValueError(f"Invalid GEN node config for '{node_id}': {err}") from err


class EngineConfig(BaseModel):
    sr: int = 48_000
    control_rate: int = 1_500
    ksmps: int = 32
    nchnls: int = 2
    software_buffer: int = 128
    hardware_buffer: int = 512
    zero_dbfs: float = Field(default=1.0, alias="0dbfs")

    model_config = {"populate_by_name": True}

    @field_validator("sr")
    @classmethod
    def validate_sr_range(cls, value: int) -> int:
        if value < AUDIO_RATE_MIN or value > AUDIO_RATE_MAX:
            raise ValueError(f"Audio sample rate must be between {AUDIO_RATE_MIN} and {AUDIO_RATE_MAX}.")
        return value

    @field_validator("control_rate")
    @classmethod
    def validate_control_rate_range(cls, value: int) -> int:
        if value < CONTROL_RATE_MIN or value > CONTROL_RATE_MAX:
            raise ValueError(
                f"Control sample rate must be between {CONTROL_RATE_MIN} and {CONTROL_RATE_MAX}."
            )
        return value

    @field_validator("ksmps")
    @classmethod
    def validate_ksmps(cls, value: int) -> int:
        if value < 1:
            raise ValueError("ksmps must be >= 1.")
        return value

    @field_validator("software_buffer", "hardware_buffer")
    @classmethod
    def validate_buffer_size_range(cls, value: int) -> int:
        if value < BUFFER_SIZE_MIN or value > BUFFER_SIZE_MAX:
            raise ValueError(f"Buffer size must be between {BUFFER_SIZE_MIN} and {BUFFER_SIZE_MAX}.")
        return value

    @model_validator(mode="after")
    def sync_rates(self) -> "EngineConfig":
        fields = self.model_fields_set
        if "control_rate" not in fields and "ksmps" in fields and self.ksmps > 0:
            derived_control_rate = round(self.sr / self.ksmps)
            if CONTROL_RATE_MIN <= derived_control_rate <= CONTROL_RATE_MAX:
                self.control_rate = derived_control_rate

        self.ksmps = max(1, round(self.sr / self.control_rate))
        return self


class PatchGraph(BaseModel):
    nodes: list[NodeInstance] = Field(default_factory=list)
    connections: list[Connection] = Field(default_factory=list)
    ui_layout: dict[str, JsonValue] = Field(default_factory=dict)
    engine_config: EngineConfig = Field(default_factory=EngineConfig)

    @field_validator("nodes")
    @classmethod
    def validate_node_count(cls, nodes: list[NodeInstance]) -> list[NodeInstance]:
        if len(nodes) > 500:
            raise ValueError("Patch exceeds maximum node count (500)")
        return nodes

    @field_validator("connections")
    @classmethod
    def validate_connection_count(cls, connections: list[Connection]) -> list[Connection]:
        if len(connections) > 2_000:
            raise ValueError("Patch exceeds maximum connection count (2000)")
        return connections

    @model_validator(mode="after")
    def validate_unique_node_ids(self) -> "PatchGraph":
        ids = [node.id for node in self.nodes]
        if len(ids) != len(set(ids)):
            raise ValueError("Node IDs must be unique")
        validate_gen_node_layout_map(self.ui_layout)
        return self


class PatchBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2_048)
    is_template: bool = False
    schema_version: int = 1
    graph: PatchGraph

    @field_validator("name")
    @classmethod
    def validate_name_text(cls, value: str) -> str:
        return reject_control_characters(value, field_name="Patch name")


class PatchCreateRequest(PatchBase):
    pass


class PatchUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2_048)
    is_template: bool | None = None
    graph: PatchGraph | None = None
    schema_version: int | None = None

    @field_validator("name")
    @classmethod
    def validate_name_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return reject_control_characters(value, field_name="Patch name")


class PatchResponse(PatchBase):
    id: str
    created_at: datetime
    updated_at: datetime


class PatchListItem(BaseModel):
    id: str
    name: str
    description: str
    is_template: bool = False
    schema_version: int
    updated_at: datetime


class PatchDocument(PatchBase):
    id: str = Field(default_factory=lambda: str(uuid4()))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
