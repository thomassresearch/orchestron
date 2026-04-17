from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from pydantic import BaseModel, Field

from backend.app.models.opcode import OpcodeSpec, PortSpec


class StoredOpcodeSpec(BaseModel):
    name: str = Field(min_length=1)
    category: str = Field(min_length=1)
    description: str = ""
    documentation_markdown: str = ""
    documentation_url: str = ""
    inputs: list[PortSpec] = Field(default_factory=list)
    outputs: list[PortSpec] = Field(default_factory=list)
    template: str = ""
    tags: list[str] = Field(default_factory=list)
    icon_filename: str = Field(min_length=1)

    def to_runtime_spec(self, icon_prefix: str) -> OpcodeSpec:
        return OpcodeSpec(
            name=self.name,
            category=self.category,
            description=self.description,
            documentation_markdown=self.documentation_markdown,
            documentation_url=self.documentation_url,
            inputs=self.inputs,
            outputs=self.outputs,
            template=self.template,
            tags=self.tags,
            icon=f"{icon_prefix.rstrip('/')}/{self.icon_filename}",
        )


class OpcodeService:
    def __init__(self, icon_prefix: str) -> None:
        self._icon_prefix = icon_prefix.rstrip("/")
        self._opcodes = {
            opcode.name: opcode
            for opcode in self._load_catalog(self._catalog_path(), icon_prefix=self._icon_prefix)
        }

    def list_opcodes(self, category: str | None = None) -> list[OpcodeSpec]:
        opcodes = list(self._opcodes.values())
        if category:
            opcodes = [opcode for opcode in opcodes if opcode.category == category]
        return sorted(opcodes, key=lambda item: (item.category, item.name))

    def get_opcode(self, name: str) -> OpcodeSpec | None:
        return self._opcodes.get(name)

    def categories(self) -> dict[str, int]:
        counters: dict[str, int] = defaultdict(int)
        for opcode in self._opcodes.values():
            counters[opcode.category] += 1
        return dict(sorted(counters.items(), key=lambda kv: kv[0]))

    @staticmethod
    def _catalog_path() -> Path:
        return Path(__file__).resolve().parents[1] / "data" / "opcodes.json"

    @staticmethod
    def _load_catalog(path: Path, *, icon_prefix: str) -> list[OpcodeSpec]:
        raw_entries = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw_entries, list):
            raise ValueError(f"Opcode catalog '{path}' must contain a JSON list.")
        return [
            StoredOpcodeSpec.model_validate(item).to_runtime_spec(icon_prefix)
            for item in raw_entries
        ]
