"""阿里云 CosyVoice provider。"""

from __future__ import annotations

import asyncio
import base64
import logging

from fastapi import WebSocketDisconnect
from fastapi.responses import Response

from providers.base import BaseTtsProvider


log = logging.getLogger("tts")


class AliyunCosyVoiceProvider(BaseTtsProvider):
    def __init__(
        self,
        *,
        model_name: str,
        api_key: str,
        api_url: str,
        synthesize_cb,
        voice_map: dict[str, str],
        speaker_info: dict[str, str],
    ):
        super().__init__(name="aliyun-cosyvoice", model_name=model_name)
        self.api_key = api_key
        self.api_url = api_url
        self._synthesize_cb = synthesize_cb
        self._voice_map = voice_map
        self._speaker_info = speaker_info

    async def startup(self) -> None:
        log.info(f"使用阿里云 CosyVoice（{self.model_name}），跳过本地模型加载")
        try:
            import dashscope  # noqa: F401

            log.info("dashscope SDK 已就绪")
            if not self.api_key:
                log.warning("未配置 API Key！合成请求将会失败，请在设置中配置 DashScope API Key")
            if not self.model_name:
                log.error("CosyVoice 模型名无效！请检查 model_name 配置格式: aliyun/cosyvoice-v3-flash")
        except ImportError:
            log.error("dashscope SDK 未安装！请运行: pip install dashscope")

    async def health(self) -> dict:
        return {
            "status": "ok",
            "model_loaded": True,
            "backend": "cosyvoice",
            "model_name": self.model_name,
            "api_key_configured": bool(self.api_key),
            "cosyvoice_model": self.model_name,
            "api_url": self.api_url,
        }

    async def run_test(self, request: dict | None = None) -> dict:
        payload = request or {}
        text = payload.get("text") or "你好，这是语音合成测试。"
        speaker = (payload.get("speaker") or "longxiaochun").strip().lower()
        loop = asyncio.get_event_loop()
        audio_bytes = await loop.run_in_executor(None, self._synthesize_cb, text, speaker)

        if not audio_bytes:
            raise RuntimeError("TTS 测试没有返回音频数据")

        return {
            "provider": "aliyun",
            "backend": "cosyvoice",
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

        speaker = (request.get("speaker") or "longxiaochun").strip().lower()
        loop = asyncio.get_event_loop()
        audio_bytes = await loop.run_in_executor(None, self._synthesize_cb, text, speaker)
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

                speaker = (data.get("speaker") or "longxiaochun").lower()

                try:
                    await ws.send_json({"status": "processing", "text": text[:50]})
                    loop = asyncio.get_event_loop()
                    audio_bytes = await loop.run_in_executor(None, self._synthesize_cb, text, speaker)
                    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
                    await ws.send_json({"audio": audio_b64, "format": "mp3"})
                    await ws.send_json({"done": True})
                except Exception as e:
                    log.error(f"CosyVoice 合成失败: {e}")
                    await ws.send_json({"error": str(e)})
        except WebSocketDisconnect:
            log.info("WebSocket 客户端断开")
        except Exception as e:
            log.error(f"WebSocket 异常: {type(e).__name__}: {e}")

    async def list_speakers(self) -> dict:
        return {
            "speakers": self._speaker_info,
            "backend": "cosyvoice",
            "model": self.model_name,
            "languages": ["chinese", "english", "japanese", "korean", "french", "german", "russian"],
        }
