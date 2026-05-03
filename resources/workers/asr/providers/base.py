"""ASR provider 抽象定义。"""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseAsrProvider(ABC):
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
    async def run_test(self) -> dict:
        raise NotImplementedError

    @abstractmethod
    async def handle_ws(self, ws) -> None:
        raise NotImplementedError
