from __future__ import annotations

from backend.app.engine import ctcsound_loader


def _reset_windows_loader_env(monkeypatch, path_value: str) -> None:
    monkeypatch.setenv("PATH", path_value)
    for env_name in (
        "VISUALCSOUND_CSOUNDLIB_PATH",
        "OPCODE6DIR64",
        "OPCODE6DIR",
        "CSOUND_HOME",
        "CSOUND64_HOME",
        "ProgramW6432",
        "ProgramFiles",
        "ProgramFiles(x86)",
    ):
        monkeypatch.delenv(env_name, raising=False)


def test_load_ctcsound_module_registers_windows_dll_directories_before_import(
    monkeypatch,
    tmp_path,
) -> None:
    csound_dir = tmp_path / "Csound6_x64" / "bin"
    csound_dir.mkdir(parents=True)
    (csound_dir / "csound64.dll").write_bytes(b"")

    added_directories: list[str] = []

    monkeypatch.setattr(ctcsound_loader.sys, "platform", "win32")
    _reset_windows_loader_env(monkeypatch, str(csound_dir))
    monkeypatch.setattr(ctcsound_loader, "_WINDOWS_DLL_DIRECTORY_HANDLES", [])
    monkeypatch.setattr(ctcsound_loader, "_WINDOWS_REGISTERED_DLL_DIRECTORIES", set())
    monkeypatch.setattr(
        ctcsound_loader.os,
        "add_dll_directory",
        lambda path: added_directories.append(path) or object(),
        raising=False,
    )

    sentinel = object()
    monkeypatch.setattr(ctcsound_loader, "_import_stock_ctcsound", lambda: sentinel)

    assert ctcsound_loader.load_ctcsound_module() is sentinel
    assert added_directories == [str(csound_dir.resolve())]


def test_load_ctcsound_module_falls_back_to_direct_binding_on_windows(monkeypatch, tmp_path) -> None:
    csound_dir = tmp_path / "Csound6_x64" / "bin"
    csound_dir.mkdir(parents=True)
    (csound_dir / "csound64.dll").write_bytes(b"")

    added_directories: list[str] = []

    monkeypatch.setattr(ctcsound_loader.sys, "platform", "win32")
    _reset_windows_loader_env(monkeypatch, str(csound_dir))
    monkeypatch.setattr(ctcsound_loader, "_WINDOWS_DLL_DIRECTORY_HANDLES", [])
    monkeypatch.setattr(ctcsound_loader, "_WINDOWS_REGISTERED_DLL_DIRECTORIES", set())
    monkeypatch.setattr(
        ctcsound_loader.os,
        "add_dll_directory",
        lambda path: added_directories.append(path) or object(),
        raising=False,
    )
    monkeypatch.setattr(
        ctcsound_loader,
        "_import_stock_ctcsound",
        lambda: (_ for _ in ()).throw(ImportError("No module named 'ctcsound'")),
    )

    sentinel = object()
    monkeypatch.setattr(ctcsound_loader, "_load_direct_ctcsound_module", lambda: sentinel)

    assert ctcsound_loader.load_ctcsound_module() is sentinel
    assert added_directories == [str(csound_dir.resolve())]
