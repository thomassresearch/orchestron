"""Bounded, process-isolated preparation of live sequencer edits."""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
import multiprocessing
from typing import Awaitable, Callable

from backend.app.models.session import SessionSequencerConfigRequest, SessionSequencerStatus
from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config
from backend.app.services.sequencer_runtime_models import SequencerRuntimeConfig


class SupersededConfigurationError(Exception):
    """An edit was superseded or its session stopped before application."""


def _prepare(request: SessionSequencerConfigRequest, channels: tuple[int, ...]) -> SequencerRuntimeConfig:
    inputs = {config.input_channel for config in request.arpeggiators}
    if len(inputs) != len(request.arpeggiators):
        raise ValueError("Arpeggiator input channels must be unique.")
    if any(config.target_channel in inputs for config in request.arpeggiators):
        raise ValueError("Arpeggiator target_channel cannot target another arpeggiator input.")
    return compile_sequencer_runtime_config(request, controller_default_channels=channels)


def _warmup() -> None:
    pass


@dataclass(slots=True)
class Preparation:
    request: SessionSequencerConfigRequest
    channels: tuple[int, ...]
    apply: Callable[[SequencerRuntimeConfig], Awaitable[SessionSequencerStatus]]
    result: asyncio.Future[SessionSequencerStatus]


class SequencerPreparationService:
    def __init__(self) -> None:
        self._pool: ProcessPoolExecutor | None = None
        self._pending: OrderedDict[str, Preparation] = OrderedDict()
        self._active: tuple[str, Preparation] | None = None
        self._dispatcher: asyncio.Task[None] | None = None
        self._closed = False

    def _executor(self) -> ProcessPoolExecutor:
        if self._closed:
            raise RuntimeError("Sequencer compiler is closed")
        if self._pool is None:
            self._pool = ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn"))
        return self._pool

    async def start(self) -> None:
        await asyncio.get_running_loop().run_in_executor(self._executor(), _warmup)

    async def prepare(self, request: SessionSequencerConfigRequest, channels: tuple[int, ...]) -> SequencerRuntimeConfig:
        return await asyncio.get_running_loop().run_in_executor(self._executor(), _prepare, request, channels)

    def invalidate(self, session_id: str) -> None:
        pending = self._pending.pop(session_id, None)
        active = self._active[1] if self._active and self._active[0] == session_id else None
        for job in (pending, active):
            if job and not job.result.done():
                job.result.set_exception(SupersededConfigurationError())

    async def submit(
        self, session_id: str, request: SessionSequencerConfigRequest, channels: tuple[int, ...],
        apply: Callable[[SequencerRuntimeConfig], Awaitable[SessionSequencerStatus]],
    ) -> SessionSequencerStatus:
        if self._closed:
            raise RuntimeError("Sequencer compiler is closed")
        self.invalidate(session_id)
        job = Preparation(request, channels, apply, asyncio.get_running_loop().create_future())
        self._pending[session_id] = job
        if self._dispatcher is None or self._dispatcher.done():
            self._dispatcher = asyncio.create_task(self._dispatch(), name="sequencer-compiler")
        return await job.result

    async def _dispatch(self) -> None:
        while self._pending:
            session_id, job = self._pending.popitem(last=False)
            self._active = (session_id, job)
            try:
                if job.result.done():
                    continue
                prepared = await self.prepare(job.request, job.channels)
                if not job.result.done():
                    status = await job.apply(prepared)
                    if not job.result.done():
                        job.result.set_result(status)
            except asyncio.CancelledError:
                if not job.result.done():
                    job.result.cancel()
                raise
            except Exception as exc:
                if not job.result.done():
                    job.result.set_exception(exc)
            finally:
                self._active = None

    async def close(self) -> None:
        self._closed = True
        for session_id in list(self._pending):
            self.invalidate(session_id)
        if self._active:
            self.invalidate(self._active[0])
        if self._dispatcher:
            self._dispatcher.cancel()
            await asyncio.gather(self._dispatcher, return_exceptions=True)
        if self._pool:
            await asyncio.to_thread(self._pool.shutdown, wait=True, cancel_futures=True)
            self._pool = None
