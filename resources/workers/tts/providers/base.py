"""TTS provider 抽象定义。"""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseTtsProvider(ABC):
    def __init__(self, *, name: str, model_name: str):
        self.name = name
        self.model_name = model_name

    @abstractmethod
    async def startup(self) -> None:
        raise NotImplementedError

    @abstractmethod
    async def health(self) -> dict:
        raise NotImplementedError

    @abstractmethod
    async def run_test(self, request: dict | None = None) -> dict:
        raise NotImplementedError

    @abstractmethod
    async def synthesize(self, request: dict):
        raise NotImplementedError

    @abstractmethod
    async def handle_ws(self, ws) -> None:
        raise NotImplementedError

    @abstractmethod
    async def list_speakers(self) -> dict:
        raise NotImplementedError
