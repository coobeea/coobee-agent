"""阿里云实时 ASR provider（基于 dashscope SDK）。

使用 dashscope SDK 的 OmniRealtimeConversation 实现实时语音识别，
与 aliyun_provider.py 的手动 WebSocket 实现形成对比。
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import queue
import threading
import time

from core.config import (
    BYTES_PER_SEC,
    SAMPLE_RATE,
)
from core.context import TranscriptSessionContext
from core.protocol import TranscriptEmitter
from core.ws_utils import safe_send_json
from providers.base import BaseAsrProvider

log = logging.getLogger("asr")

EVENT_TIMEOUT_SECONDS = 30.0


class _SdkCallback:
    """dashscope SDK 回调 → 线程安全队列桥接。"""

    def __init__(self, event_queue: queue.Queue):
        self._q = event_queue

    def on_open(self) -> None:
        self._q.put(("open", None))

    def on_close(self, close_status_code, close_msg) -> None:
        self._q.put(("close", {"code": close_status_code, "msg": close_msg}))

    def on_event(self, response) -> None:
        self._q.put(("event", response))


class AliyunSdkProvider(BaseAsrProvider):
    def __init__(
        self,
        *,
        model_name: str,
        model_dir: str,
        api_url: str,
        api_key: str,
    ):
        super().__init__(name="aliyun_sdk", model_name=model_name)
        self.model_dir = model_dir
        self.api_url = api_url
        self.api_key = api_key
        self.model_loaded = False

    async def startup(self) -> None:
        try:
            import dashscope
            from dashscope.audio.qwen_omni.omni_realtime import OmniRealtimeConversation
            self.model_loaded = True
            log.info(
                f"使用阿里云 SDK 实时语音识别: model={self.model_name}, "
                f"api_url={self.api_url}, "
                f"api_key={'已配置' if self.api_key else '未配置'}, "
                f"sdk_version={getattr(dashscope, '__version__', 'unknown')}"
            )
        except ImportError:
            self.model_loaded = False
            log.warning("dashscope SDK 未安装，aliyun_sdk provider 不可用")

    async def health(self) -> dict:
        return {
            "status": "ok" if self.model_loaded else "unavailable",
            "model_loaded": self.model_loaded,
            "provider": self.name,
            "model_name": self.model_name,
            "model_dir": self.model_dir,
            "resolved_model_path": None,
            "api_key_configured": bool(self.api_key),
            "api_url": self.api_url,
        }

    async def run_test(self) -> dict:
        if not self.api_key:
            raise RuntimeError("未配置阿里云 DashScope API Key")

        if not self.model_loaded:
            raise RuntimeError("dashscope SDK 未安装")

        import dashscope
        from dashscope.audio.qwen_omni.omni_realtime import (
            AudioFormat,
            MultiModality,
            OmniRealtimeCallback,
            OmniRealtimeConversation,
            TranscriptionParams,
        )

        dashscope.api_key = self.api_key
        event_types = []

        class TestCallback(OmniRealtimeCallback):
            def on_open(self) -> None:
                pass

            def on_close(self, close_status_code, close_msg) -> None:
                pass

            def on_event(self, response) -> None:
                event_types.append(str(response.get("type", "")))

        conversation = OmniRealtimeConversation(
            model=self.model_name,
            url=self.api_url,
            callback=TestCallback(),
        )
        conversation.connect()

        conversation.update_session(
            output_modalities=[MultiModality.TEXT],
            enable_input_audio_transcription=True,
            transcription_params=TranscriptionParams(
                language="zh",
                sample_rate=16000,
                input_audio_format="pcm",
            ),
        )

        silence = bytes(int(BYTES_PER_SEC * 0.8))
        audio_b64 = base64.b64encode(silence).decode("ascii")
        conversation.append_audio(audio_b64)

        await asyncio.sleep(2)

        conversation.close()

        return {
            "provider": self.name,
            "model_name": self.model_name,
            "api_url": self.api_url,
            "events": event_types,
            "message": "阿里云 SDK ASR 测试完成",
        }

    async def handle_ws(self, ws) -> None:
        await ws.accept()

        if not self.api_key:
            await safe_send_json(ws, {"error": "未配置阿里云 DashScope API Key"})
            await ws.close(code=1008)
            return

        if not self.model_loaded:
            await safe_send_json(ws, {"error": "dashscope SDK 未安装"})
            await ws.close(code=1008)
            return

        import dashscope
        from dashscope.audio.qwen_omni.omni_realtime import (
            MultiModality,
            OmniRealtimeCallback,
            OmniRealtimeConversation,
            TranscriptionParams,
        )

        dashscope.api_key = self.api_key

        transcript = TranscriptSessionContext(provider=self.name)
        emitter = TranscriptEmitter(
            provider=self.name,
            log_label="ALIYUN_SDK_TRANSCRIPT",
            send_json=lambda payload: safe_send_json(ws, payload),
        )
        forwarded_chunks = 0
        forwarded_bytes = 0

        while True:
            event_queue: queue.Queue = queue.Queue()
            callback = _SdkCallback(event_queue)

            try:
                conversation = OmniRealtimeConversation(
                    model=self.model_name,
                    url=self.api_url,
                    callback=callback,
                )
                conversation.connect()
            except Exception as e:
                log.warning(f"[ALIYUN_SDK] 连接失败: {e}")
                await safe_send_json(ws, {"error": f"阿里云 SDK 连接失败: {e}"})
                break

            try:
                conversation.update_session(
                    output_modalities=[MultiModality.TEXT],
                    enable_input_audio_transcription=True,
                    transcription_params=TranscriptionParams(
                        language="zh",
                        sample_rate=SAMPLE_RATE,
                        input_audio_format="pcm",
                    ),
                )

                result = await self._relay_session(
                    ws, conversation, event_queue,
                    transcript, emitter,
                    forwarded_chunks, forwarded_bytes,
                )
            finally:
                with contextlib.suppress(Exception):
                    conversation.close()

            forwarded_chunks = result["forwarded_chunks"]
            forwarded_bytes = result["forwarded_bytes"]

            if result["reason"] == "client_disconnect":
                break

            if result["reason"] == "timeout":
                log.info("[ALIYUN_SDK] 超时断开，等待新音频以自动重连...")
                await safe_send_json(ws, {
                    "status": "paused",
                    "message": "ASR 连接因超时暂停，开始说话将自动重连",
                })

                has_audio = await self._wait_for_audio(ws)
                if not has_audio:
                    break

                log.info("[ALIYUN_SDK] 检测到新音频，自动重连...")
                await safe_send_json(ws, {
                    "status": "reconnected",
                    "message": "ASR 已自动重连",
                })
                continue

            break

        if transcript.committed_text:
            await emitter.emit(
                transcript,
                "session_final",
                is_final_session=True,
            )
        log.info(
            f"[ALIYUN_SDK_SESSION] closed forwarded_kb={forwarded_bytes / 1024:.1f} "
            f"committed_len={len(transcript.committed_text)}"
        )
        with contextlib.suppress(Exception):
            await ws.close()

    async def _wait_for_audio(self, ws) -> bool:
        """等待前端发来新的音频数据。返回 True 表示收到音频，False 表示前端断开。"""
        try:
            while True:
                message = await ws.receive()
                if message.get("type") == "websocket.disconnect":
                    return False
                if message.get("bytes"):
                    return True
        except Exception:
            return False

    async def _relay_session(
        self,
        ws,
        conversation,
        event_queue: queue.Queue,
        transcript: TranscriptSessionContext,
        emitter: TranscriptEmitter,
        init_chunks: int,
        init_bytes: int,
    ) -> dict:
        """处理一次阿里云连接，返回结束原因和统计信息。"""
        last_partial = ""
        last_event_at = time.time()
        last_audio_at = time.time()
        forwarded_chunks = init_chunks
        forwarded_bytes = init_bytes
        last_audio_log_at = 0.0
        end_reason = "unknown"

        loop = asyncio.get_event_loop()

        async def forward_audio():
            nonlocal forwarded_chunks, forwarded_bytes, last_audio_log_at, last_audio_at
            try:
                while True:
                    message = await ws.receive()
                    if message.get("type") == "websocket.disconnect":
                        return "client_disconnect"

                    audio = message.get("bytes")
                    if not audio:
                        continue

                    forwarded_chunks += 1
                    forwarded_bytes += len(audio)
                    last_audio_at = time.time()
                    now = time.time()
                    if now - last_audio_log_at >= 2.0:
                        last_audio_log_at = now
                        log.info(
                            f"[ALIYUN_SDK_AUDIO_IN] chunks={forwarded_chunks} "
                            f"forwarded_kb={forwarded_bytes / 1024:.1f}"
                        )

                    audio_b64 = base64.b64encode(audio).decode("ascii")
                    await loop.run_in_executor(None, conversation.append_audio, audio_b64)
            except Exception:
                return "audio_error"

        async def forward_events():
            nonlocal last_partial, last_event_at
            try:
                while True:
                    try:
                        item = await loop.run_in_executor(None, event_queue.get, True, 0.5)
                    except queue.Empty:
                        continue

                    kind, data = item
                    if kind == "close":
                        log.info(
                            f"[ALIYUN_SDK] 连接关闭: code={data.get('code')} msg={data.get('msg')}"
                        )
                        return "server_close"

                    if kind != "event" or not isinstance(data, dict):
                        continue

                    last_event_at = time.time()
                    event_type = str(data.get("type", ""))
                    log.info(f"[ALIYUN_SDK_EVENT] type={event_type}")

                    if event_type.endswith(".failed") or event_type in {"error", "session.failed"}:
                        error = data.get("error")
                        if isinstance(error, dict):
                            msg = error.get("message") or error.get("code")
                        else:
                            msg = data.get("message") or error
                        msg = msg or "阿里云 SDK ASR 识别失败"
                        await safe_send_json(ws, {"error": str(msg)})
                        continue

                    if "input_audio_transcription" not in event_type:
                        if event_type == "session.finished":
                            return "server_close"
                        continue

                    text = self._extract_text(data)
                    if not text:
                        continue

                    if event_type.endswith(".completed"):
                        turn_id = transcript.ensure_turn_id()
                        revision = transcript.ensure_revision()
                        transcript.merge_committed(text)
                        last_partial = ""
                        if not await emitter.emit(
                            transcript,
                            "turn_final",
                            turn_id=turn_id,
                            revision=revision,
                            draft="",
                            is_final_turn=True,
                        ):
                            return "client_disconnect"
                        transcript.reset_turn()
                    elif text != last_partial:
                        turn_id = transcript.ensure_turn_id()
                        revision = transcript.bump_revision()
                        last_partial = text
                        if not await emitter.emit(
                            transcript,
                            "update",
                            draft=text,
                            turn_id=turn_id,
                            revision=revision,
                        ):
                            return "client_disconnect"
            except Exception as e:
                log.info(f"[ALIYUN_SDK] event_forward_end type={type(e).__name__} error={e}")
                return "event_error"

        async def monitor_timeout():
            while True:
                await asyncio.sleep(5.0)
                last_active = max(last_event_at, last_audio_at)
                elapsed = time.time() - last_active
                if elapsed > EVENT_TIMEOUT_SECONDS:
                    log.warning(
                        f"[ALIYUN_SDK_TIMEOUT] 事件超时 {elapsed:.0f}s > {EVENT_TIMEOUT_SECONDS}s，"
                        f"chunks={forwarded_chunks} committed_len={len(transcript.committed_text)}"
                    )
                    return "timeout"

        audio_task = asyncio.create_task(forward_audio())
        event_task = asyncio.create_task(forward_events())
        monitor_task = asyncio.create_task(monitor_timeout())
        done, pending = await asyncio.wait(
            {audio_task, event_task, monitor_task},
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in pending:
            task.cancel()
        for task in pending:
            with contextlib.suppress(asyncio.CancelledError):
                await task

        for task in done:
            result = task.result()
            if isinstance(result, str):
                end_reason = result

        if last_partial:
            transcript.ensure_turn_id()
            transcript.ensure_revision()
            transcript.merge_committed(last_partial)
            last_partial = ""

        return {
            "reason": end_reason,
            "forwarded_chunks": forwarded_chunks,
            "forwarded_bytes": forwarded_bytes,
        }

    @staticmethod
    def _extract_text(event: dict) -> str:
        for key in ("transcript", "text", "delta"):
            value = event.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        item = event.get("item")
        if isinstance(item, dict):
            for key in ("transcript", "text", "delta"):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()

            content = item.get("content")
            if isinstance(content, list):
                texts = []
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    for key in ("transcript", "text"):
                        value = part.get(key)
                        if isinstance(value, str) and value.strip():
                            texts.append(value.strip())
                if texts:
                    return " ".join(texts)

        stash = event.get("stash")
        if isinstance(stash, str) and stash.strip():
            return stash.strip()

        return ""
