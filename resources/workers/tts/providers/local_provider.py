"""本地 TTS provider。"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import time

from fastapi import WebSocketDisconnect
from fastapi.responses import Response

from providers.base import BaseTtsProvider


log = logging.getLogger("tts")


class LocalTtsProvider(BaseTtsProvider):
    def __init__(
        self,
        *,
        model_name: str,
        model_dir: str,
        get_model_loaded,
        startup_cb,
        synthesize_cb,
        speaker_info: dict[str, str],
        lang_map: dict[str, str],
    ):
        super().__init__(name="local", model_name=model_name)
        self.model_dir = model_dir
        self._get_model_loaded = get_model_loaded
        self._startup_cb = startup_cb
        self._synthesize_cb = synthesize_cb
        self._speaker_info = speaker_info
        self._lang_map = lang_map

    async def startup(self) -> None:
        await self._startup_cb()

    async def health(self) -> dict:
        return {
            "status": "ok",
            "model_loaded": self._get_model_loaded(),
            "backend": "local",
            "model_name": self.model_name,
            "model_dir": self.model_dir,
        }

    async def run_test(self, request: dict | None = None) -> dict:
        payload = request or {}
        text = payload.get("text") or "你好，这是语音合成测试。"
        speaker = (payload.get("speaker") or "vivian").strip().lower()

        if not self._get_model_loaded():
            raise RuntimeError("TTS 模型尚未加载完成")

        loop = asyncio.get_event_loop()
        wav_data, sample_rate = await loop.run_in_executor(None, self._synthesize_cb, text, speaker, "chinese", "")
        audio_bytes = bytes(memoryview(wav_data))

        if not audio_bytes:
            raise RuntimeError("TTS 测试没有返回音频数据")

        return {
            "provider": self.name,
            "backend": self.name,
            "model_name": self.model_name,
            "speaker": speaker,
            "format": "wav",
            "sample_rate": sample_rate,
            "duration": round(len(wav_data) / sample_rate, 2),
            "text": text,
            "audio_bytes": len(audio_bytes),
            "message": "TTS 合成测试完成",
        }

    async def synthesize(self, request: dict):
        text = request.get("text", "")
        if not text:
            raise RuntimeError("缺少 text 字段")

        if not self._get_model_loaded():
            raise RuntimeError("模型未加载")

        speaker = (request.get("speaker") or "vivian").strip().lower()
        language = (request.get("language") or "chinese").lower()
        instruct = request.get("instruct", "")
        language = self._lang_map.get(language, language)

        if speaker not in self._speaker_info:
            raise RuntimeError(f"未知音色 '{speaker}'")

        import soundfile as sf

        wav_data, sample_rate = self._synthesize_cb(text, speaker, language, instruct)
        wav_buffer = io.BytesIO()
        sf.write(wav_buffer, wav_data, sample_rate, format="WAV")
        wav_buffer.seek(0)
        return Response(
            content=wav_buffer.read(),
            media_type="audio/wav",
            headers={"Content-Disposition": "attachment; filename=tts_output.wav"},
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

                if not self._get_model_loaded():
                    await ws.send_json({"error": "模型未加载"})
                    continue

                speaker = (data.get("speaker") or "vivian").lower()
                language = (data.get("language") or "chinese").lower()
                language = self._lang_map.get(language, language)
                instruct = data.get("instruct", "")

                if speaker not in self._speaker_info:
                    await ws.send_json({"error": f"未知音色 '{speaker}'", "available": list(self._speaker_info.keys())})
                    continue

                try:
                    import soundfile as sf

                    await ws.send_json({"status": "processing", "text": text[:50]})
                    loop = asyncio.get_event_loop()
                    wav_data, sample_rate = await loop.run_in_executor(
                        None, self._synthesize_cb, text, speaker, language, instruct
                    )
                    wav_buffer = io.BytesIO()
                    sf.write(wav_buffer, wav_data, sample_rate, format="WAV")
                    wav_buffer.seek(0)
                    audio_b64 = base64.b64encode(wav_buffer.read()).decode("utf-8")
                    duration = len(wav_data) / sample_rate
                    await ws.send_json({"audio": audio_b64, "duration": round(duration, 2), "sample_rate": sample_rate})
                    await ws.send_json({"done": True})
                except Exception as e:
                    log.error(f"合成失败: {e}")
                    await ws.send_json({"error": str(e)})
        except WebSocketDisconnect:
            log.info("WebSocket 客户端断开")
        except Exception as e:
            log.error(f"WebSocket 异常: {type(e).__name__}: {e}")

    async def list_speakers(self) -> dict:
        return {
            "speakers": self._speaker_info,
            "backend": "local",
            "languages": sorted(set(self._lang_map.values())),
        }
