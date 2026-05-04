"""Edge TTS provider。"""

from __future__ import annotations

import base64
import logging

from fastapi import WebSocketDisconnect
from fastapi.responses import Response

from providers.base import BaseTtsProvider


log = logging.getLogger("tts")


class EdgeTtsProvider(BaseTtsProvider):
    def __init__(
        self,
        *,
        model_name: str,
        synthesize_cb,
        voice_map: dict[str, str],
        speaker_info: dict[str, str],
    ):
        super().__init__(name="edge", model_name=model_name)
        self._synthesize_cb = synthesize_cb
        self._voice_map = voice_map
        self._speaker_info = speaker_info

    async def startup(self) -> None:
        try:
            import edge_tts  # noqa: F401

            log.info("使用 Microsoft Edge TTS（免费在线），跳过本地模型加载")
            log.info("edge-tts 库已就绪")
        except ImportError:
            log.error("edge-tts 未安装！请运行: pip install edge-tts")

    async def health(self) -> dict:
        return {
            "status": "ok",
            "model_loaded": True,
            "backend": "edge-tts",
            "model_name": self.model_name,
        }

    async def run_test(self, request: dict | None = None) -> dict:
        payload = request or {}
        text = payload.get("text") or "你好，这是语音合成测试。"
        speaker = (payload.get("speaker") or "xiaoxiao").strip().lower()
        audio_bytes = await self._synthesize_cb(text, speaker)

        if not audio_bytes:
            raise RuntimeError("TTS 测试没有返回音频数据")

        return {
            "provider": "microsoft",
            "backend": "edge-tts",
            "model_name": self.model_name,
            "speaker": self._voice_map.get(speaker, speaker),
            "format": "mp3",
            "text": text,
            "audio_bytes": len(audio_bytes),
            "message": "TTS 合成测试完成",
        }

    async def synthesize(self, request: dict):
        text = request.get("text", "")
        if not text:
            raise RuntimeError("缺少 text 字段")

        speaker = (request.get("speaker") or "xiaoxiao").strip().lower()
        audio_bytes = await self._synthesize_cb(text, speaker)
        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={"Content-Disposition": "attachment; filename=tts_output.mp3"},
        )

    async def handle_ws(self, ws) -> None:
        await ws.accept()
        log.info("WebSocket 客户端已连接")

        try:
            while True:
                data = await ws.receive_json()
                text = data.get("text", "")
                if not text:
                    await ws.send_json({"error": "缺少 text 字段"})
                    continue

                speaker = (data.get("speaker") or "xiaoxiao").lower()

                try:
                    await ws.send_json({"status": "processing", "text": text[:50]})
                    audio_bytes = await self._synthesize_cb(text, speaker)
                    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
                    await ws.send_json({"audio": audio_b64, "format": "mp3"})
                    await ws.send_json({"done": True})
                except Exception as e:
                    log.error(f"Edge TTS 合成失败: {e}")
                    await ws.send_json({"error": str(e)})
        except WebSocketDisconnect:
            log.info("WebSocket 客户端断开")
        except Exception as e:
            log.error(f"WebSocket 异常: {type(e).__name__}: {e}")

    async def list_speakers(self) -> dict:
        return {
            "speakers": self._speaker_info,
            "backend": "edge-tts",
            "languages": ["chinese", "english", "japanese", "korean"],
        }
