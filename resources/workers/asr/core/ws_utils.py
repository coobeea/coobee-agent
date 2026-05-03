"""ASR WebSocket 公共工具。"""

from __future__ import annotations


async def safe_send_json(ws, payload: dict) -> bool:
    try:
        await ws.send_json(payload)
        return True
    except Exception:
        return False
