from __future__ import annotations

import ctypes

import numpy as np

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


def test_direct_binding_buffer_view_lifecycle() -> None:
    class Library:
        size = 4
        channels = 2

        def __init__(self):
            self.buffer = (ctypes.c_double * 16)(*range(16))

        def csoundCreate(self, _):
            return 1

        def csoundDestroy(self, _):
            pass

        def csoundGetKsmps(self, _):
            return self.size

        def csoundGetNchnls(self, _):
            return self.channels

        def csoundGetSpout(self, _):
            return ctypes.cast(self.buffer, ctypes.POINTER(ctypes.c_double))

        def csoundCompileCsdText(self, *_):
            return 0

        def csoundStart(self, _):
            return 0

        def csoundStop(self, _):
            pass

        def csoundCleanup(self, _):
            return 0

        def csoundReset(self, _):
            pass

    lib = Library()
    cs = ctcsound_loader._build_direct_csound_class(lib)()
    cs.start()
    view = cs.spout()
    assert view.shape == (8,)
    assert cs.spout() is view
    lib.buffer[0] = 99
    assert cs.spout()[0] == 99
    detached = cs.spout().copy()
    lib.buffer[0] = 21
    assert detached[0] == 99
    for transition in (cs.stop, cs.cleanup, cs.reset, lambda: cs.compileCsdText(''), cs.start):
        previous = cs.spout()
        transition()
        lib.size = 2 if lib.size == 4 else 4
        lib.buffer = (ctypes.c_double * 16)(*range(16, 32))
        assert cs.spout().shape == (lib.size * lib.channels,)
        assert cs.spout()[0] == 16
        assert cs.spout() is not previous
    cs.reset()
    lib.size = 0
    assert np.size(cs.spout()) == 0
    lib.size = 4
    assert cs.spout().shape == (8,)


def test_direct_audio_channel_bridge_validates_native_abi_and_buffers():
    from unittest.mock import Mock
    from types import SimpleNamespace
    import pytest

    stored = np.arange(4, dtype=np.float64)

    def get(_cs, _name, pointer):
        np.ctypeslib.as_array(pointer, shape=(4,))[:] = stored

    def put(_cs, _name, pointer):
        stored[:] = np.ctypeslib.as_array(pointer, shape=(4,))

    library = SimpleNamespace(csoundCreate=Mock(return_value=1), csoundDestroy=Mock(),
        csoundGetSizeOfMYFLT=Mock(return_value=8), csoundGetKsmps=Mock(return_value=4),
        csoundGetAudioChannel=Mock(side_effect=get), csoundSetAudioChannel=Mock(side_effect=put))
    cs = ctcsound_loader._build_direct_csound_class(library)()
    output = np.zeros(4, dtype=np.float64)
    cs.audioChannel('bus', output)
    np.testing.assert_array_equal(output, stored)
    output[:] = [-.5, .25, 1e-20, -1e20]
    cs.setAudioChannel('bus', output)
    np.testing.assert_array_equal(stored, output)
    for invalid in (np.zeros(3), np.zeros(8)[::2], np.zeros(4, dtype=np.float32), [0.] * 4, np.zeros((4, 1))):
        with pytest.raises(ValueError):
            cs.audioChannel('bus', invalid)
        with pytest.raises(ValueError):
            cs.setAudioChannel('bus', invalid)
    output.flags.writeable = False
    with pytest.raises(ValueError):
        cs.audioChannel('bus', output)
    cs.setAudioChannel('bus', output)  # Read-only input is valid.
    library.csoundGetSizeOfMYFLT.return_value = 4
    with pytest.raises(RuntimeError, match='MYFLT width'):
        cs.audioChannel('bus', np.zeros(4))
    with pytest.raises(RuntimeError, match='MYFLT width'):
        cs.setAudioChannel('bus', np.zeros(4))
    assert library.csoundGetAudioChannel.call_count == 1
    assert library.csoundSetAudioChannel.call_count == 2
