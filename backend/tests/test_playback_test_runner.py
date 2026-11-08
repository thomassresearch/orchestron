"""A crashed native module must fail CI without hiding later test results."""
import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize("failure", ["assert False", "import os; os._exit(17)", "pass"])
def test_runner_preserves_failures_and_continues(tmp_path, failure):
    first = tmp_path / "test_first.py"
    last = tmp_path / "test_last.py"
    marker = tmp_path / "completed"
    first.write_text(f"def test_first():\n    {failure}\n")
    last.write_text(f"def test_last():\n    from pathlib import Path\n    Path({str(marker)!r}).touch()\n")
    env = {**os.environ, "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1"}
    result = subprocess.run([sys.executable, "-m", "backend.tools.run_playback_tests", str(first), str(last)],
                            cwd=Path(__file__).resolve().parents[2], env=env, capture_output=True, text=True)
    assert result.returncode == (0 if failure == "pass" else 1), result.stdout + result.stderr
    assert marker.exists(), result.stdout + result.stderr
    if failure != "pass":
        assert f"FAILED module {first}" in result.stdout
