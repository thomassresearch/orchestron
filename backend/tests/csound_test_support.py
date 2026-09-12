from pathlib import Path

from backend.app.models.patch import PatchDocument


def load_patch_fixture(name: str) -> PatchDocument:
    """Load an independent patch document from the versioned test fixtures."""
    path = Path(__file__).resolve().parent / "fixtures" / "patches" / f"{name}.patch.json"
    return PatchDocument.model_validate_json(path.read_text(encoding="utf-8"))


def orc_code_lines(orc: str) -> list[str]:
    """Opcode assertions must inspect statements, not instrument descriptions."""
    return [line for line in orc.splitlines() if line.strip() and not line.lstrip().startswith(";")]
