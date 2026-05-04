"""AI Studio OCR provider。"""

from __future__ import annotations

import base64
import logging

from fastapi import WebSocketDisconnect

from providers.base import BaseOcrProvider


log = logging.getLogger("ocr")


class AistudioOcrProvider(BaseOcrProvider):
    def __init__(
        self,
        *,
        model_name: str,
        model_dir: str,
        api_key: str,
        api_url: str,
        recognize_cb,
        create_test_image_cb,
    ):
        super().__init__(name="aistudio", model_name=model_name)
        self.model_dir = model_dir
        self.api_key = api_key
        self.api_url = api_url
        self._recognize_cb = recognize_cb
        self._create_test_image_cb = create_test_image_cb

    async def startup(self) -> None:
        log.info(
            f"使用在线 OCR: model={self.model_name}, "
            f"api_url={self.api_url}, api_key={'已配置' if self.api_key else '未配置'}"
        )

    async def health(self) -> dict:
        return {
            "status": "ok",
            "model_loaded": True,
            "provider": self.name,
            "model_name": self.model_name,
            "model_dir": self.model_dir,
            "api_key_configured": bool(self.api_key),
            "api_url": self.api_url,
        }

    async def run_test(self, request: dict | None = None) -> dict:
        payload = request or {}
        sample_text = payload.get("text") or "OCR TEST 123"
        image_bytes = self._create_test_image_cb(sample_text)
        text, inference_latency_ms = await self._recognize_cb(image_bytes, "text")
        return {
            "provider": self.name,
            "model_name": self.model_name,
            "sample_text": sample_text,
            "text": text[:500],
            "inference_latency_ms": inference_latency_ms,
            "message": "OCR 识别测试完成",
        }

    async def recognize(self, request: dict) -> dict:
        image_data = request.get("image", "")
        task = request.get("task", "text")
        if not image_data:
            raise RuntimeError("缺少 image 字段")

        image_bytes = base64.b64decode(image_data)
        text, latency_ms = await self._recognize_cb(image_bytes, task)
        return {"success": True, "text": text, "latency_ms": latency_ms}

    async def handle_ws(self, ws) -> None:
        await ws.accept()
        log.info("WebSocket 客户端已连接")
        await ws.send_json({"status": "ready", "message": "OCR 服务已就绪"})

        try:
            while True:
                data = await ws.receive_json()
                image_data = data.get("image", "")
                task = data.get("task", "text")

                if not image_data:
                    await ws.send_json({"status": "error", "error": "缺少 image 字段"})
                    continue

                await ws.send_json({"status": "processing", "message": "正在识别..."})

                try:
                    image_bytes = base64.b64decode(image_data)
                    text, latency_ms = await self._recognize_cb(image_bytes, task)
                    await ws.send_json({"status": "success", "text": text, "latency_ms": latency_ms})
                except Exception as e:
                    log.error(f"OCR 处理异常: {e}")
                    await ws.send_json({"status": "error", "error": str(e)})
        except (WebSocketDisconnect, Exception) as e:
            log.info(f"WebSocket 断开: {type(e).__name__}")
