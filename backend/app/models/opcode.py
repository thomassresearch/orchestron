from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class SignalType(StrEnum):
    AUDIO = "a"
    CONTROL = "k"
    INIT = "i"
    STRING = "S"
    FTABLE = "f"


class PortSpec(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    signal_type: SignalType
    required: bool = True
    default: str | int | float | None = None
    description: str = ""


class OpcodeSpec(BaseModel):
    name: str = Field(min_length=1)
    category: str = Field(min_length=1)
    description: str = ""
    icon: str
    inputs: list[PortSpec] = Field(default_factory=list)
    outputs: list[PortSpec] = Field(default_factory=list)
    template: str = ""
    tags: list[str] = Field(default_factory=list)

    @property
    def is_sink(self) -> bool:
        return len(self.outputs) == 0
