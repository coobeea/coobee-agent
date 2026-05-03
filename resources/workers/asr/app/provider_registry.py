"""ASR provider 注册与选择。"""

from __future__ import annotations


class ProviderRegistry:
    def __init__(self):
        self._providers = {}

    def register(self, provider) -> None:
        self._providers[provider.name] = provider

    def get(self, name: str):
        if name not in self._providers:
            raise KeyError(f'ASR provider "{name}" not registered')
        return self._providers[name]

    def has(self, name: str) -> bool:
        return name in self._providers

    def names(self) -> list[str]:
        return list(self._providers.keys())
