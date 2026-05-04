"""阿里云 Qwen TTS Realtime provider。"""

from __future__ import annotations

import base64
import logging

from fastapi import WebSocketDisconnect
from fastapi.responses import Response

from providers.base import BaseTtsProvider


log = logging.getLogger("tts")


class AliyunQwenTtsProvider(BaseTtsProvider):
    def __init__(
        self,
        *,
        model_name: str,
        api_key: str,
        api_url: str,
        synthesize_cb,
        voice_cb,
    ):
        super().__init__(name="aliyun-qwen", model_name=model_name)
        self.api_key = api_key
        self.api_url = api_url
        self._synthesize_cb = synthesize_cb
        self._voice_cb = voice_cb

    async def startup(self) -> None:
        log.info(f"使用阿里云 Qwen-TTS-Realtime（{self.model_name}），跳过本地模型加载")
        try:
            import websockets  # noqa: F401

            log.info("websockets 库已就绪")
            if not self.api_key:
                log.warning("未配置 API Key！合成请求将会失败，请在设置中配置 DashScope API Key")
        except ImportError:
            log.error("websockets 未安装！请运行: pip install websockets")

    async def health(self) -> dict:
        return {
            "status": "ok",
            "model_loaded": True,
            "backend": "qwen-tts-realtime",
            "model_name": self.model_name,
            "api_key_configured": bool(self.api_key),
            "api_url": self.api_url,
        }

    async def run_test(self, request: dict | None = None) -> dict:
        payload = request or {}
        text = payload.get("text") or "你好，这是语音合成测试。"
        speaker = (payload.get("speaker") or "Cherry").strip().lower()
        audio_bytes = await self._synthesize_cb(text, speaker)

        if not audio_bytes:
            raise RuntimeError("TTS 测试没有返回音频数据")

        return {
            "provider": "aliyun",
            "backend": "qwen-tts-realtime",
            "model_name": self.model_name,
            "speaker": self._voice_cb(speaker),
            "format": "mp3",
            "sample_rate": 24000,
            "text": text,
            "audio_bytes": len(audio_bytes),
            "message": "TTS 合成测试完成",
        }

    async def synthesize(self, request: dict):
        text = request.get("text", "")
        if not text:
            raise RuntimeError("缺少 text 字段")

        speaker = (request.get("speaker") or "Cherry").strip().lower()
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

                speaker = (data.get("speaker") or "Cherry").lower()

                try:
                    await ws.send_json({"status": "processing", "text": text[:50]})
                    audio_bytes = await self._synthesize_cb(text, speaker)
                    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
                    await ws.send_json({"audio": audio_b64, "format": "mp3", "sample_rate": 24000})
                    await ws.send_json({"done": True})
                except Exception as e:
                    log.error(f"Qwen-TTS-Realtime 合成失败: {e}")
                    await ws.send_json({"error": str(e)})
        except WebSocketDisconnect:
            log.info("WebSocket 客户端断开")
        except Exception as e:
            log.error(f"WebSocket 异常: {type(e).__name__}: {e}")

    async def list_speakers(self) -> dict:
        return {
            "speakers": {
                "Cherry": "自然活泼女声",
                "Chelsie": "清亮女声",
                "Serena": "温柔女声",
                "Ethan": "自然男声",
                "Eric": "四川方言男声",
                "Sunny": "四川方言女声",
                "Peter": "天津方言男声",
                "Rocky": "粤语男声",
                "Kiki": "粤语女声",
            },
            "backend": "qwen-tts-realtime",
            "model": self.model_name,
            "languages": ["chinese", "english"],
        }
