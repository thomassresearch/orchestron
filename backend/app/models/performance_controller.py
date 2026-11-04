from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

ControllerNumber = Annotated[float, Field(strict=True, allow_inf_nan=False)]
PerformanceMidiCC = Annotated[int, Field(strict=True, ge=1, le=50)]
MAX_SAFE_INTEGER = 2**53 - 1


def is_safe_integer(value: float) -> bool:
    return value == int(value) and abs(value) <= MAX_SAFE_INTEGER


class PerformanceControllerDefinition(BaseModel):
    node_id: str
    controller_type: Literal["float", "integer", "bool"] = "float"
    min: ControllerNumber = 0
    max: ControllerNumber = 1
    default: ControllerNumber = 0.5
    scale: Literal["linear", "logarithmic"] = "linear"
    label: str = Field(default="Parameter", min_length=1, max_length=128)
    controller_group: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, max_length=128)] = ""
    error: str | None = None

    @model_validator(mode="before")
    @classmethod
    def type_defaults(cls, data):
        if isinstance(data, dict) and data.get("controller_type") in ("integer", "bool"):
            return {"default": 0, **data}
        return data

    @model_validator(mode="after")
    def validate_range(self):
        if not self.label.strip():
            raise ValueError("Controller label must not be blank.")
        if self.controller_type != "float" and self.scale != "linear":
            raise ValueError("Integer and bool controllers require linear scale.")
        if self.controller_type == "integer" and not all(is_safe_integer(value) for value in (self.min, self.max, self.default)):
            raise ValueError("Integer controller minimum, maximum and default must be safe integers.")
        if self.controller_type == "bool" and (self.min != 0 or self.max != 1 or self.default not in (0, 1)):
            raise ValueError("Bool controllers require minimum 0, maximum 1 and default 0 or 1.")
        if self.min >= self.max:
            raise ValueError("Controller minimum must be smaller than maximum.")
        if not self.min <= self.default <= self.max:
            raise ValueError("Controller default must be within its range.")
        if self.scale == "logarithmic" and self.min <= 0:
            raise ValueError("Logarithmic controller minimum must be positive.")
        return self


class PerformanceControllerUpdate(BaseModel):
    values: dict[str, ControllerNumber] = Field(default_factory=dict)


class PerformanceControllerDelta(BaseModel):
    # Validated into SessionSequencerConfigRequest by the service to avoid the
    # existing session -> performance_controller model dependency cycle.
    sequencer_config: dict | None = None
    values: dict[str, ControllerNumber | None] = Field(default_factory=dict)
    midi_ccs: dict[str, PerformanceMidiCC | None] = Field(default_factory=dict)
    revisions: dict[str, Annotated[int, Field(strict=True, ge=0)]] = Field(default_factory=dict)
    midi_revisions: dict[str, Annotated[int, Field(strict=True, ge=0)]] = Field(default_factory=dict)
