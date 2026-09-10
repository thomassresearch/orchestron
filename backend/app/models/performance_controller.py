from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

ControllerNumber = Annotated[float, Field(strict=True, allow_inf_nan=False)]


class PerformanceControllerDefinition(BaseModel):
    node_id: str
    min: ControllerNumber = 0
    max: ControllerNumber = 1
    default: ControllerNumber = 0.5
    scale: Literal["linear", "logarithmic"] = "linear"
    label: str = Field(default="Parameter", min_length=1, max_length=128)
    error: str | None = None

    @model_validator(mode="after")
    def validate_range(self):
        if not self.label.strip():
            raise ValueError("Controller label must not be blank.")
        if self.min >= self.max:
            raise ValueError("Controller minimum must be smaller than maximum.")
        if not self.min <= self.default <= self.max:
            raise ValueError("Controller default must be within its range.")
        if self.scale == "logarithmic" and self.min <= 0:
            raise ValueError("Logarithmic controller minimum must be positive.")
        return self


class PerformanceControllerUpdate(BaseModel):
    values: dict[str, ControllerNumber] = Field(default_factory=dict)
