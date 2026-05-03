"""阿里云实时 ASR provider。"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import time
import urllib.parse
import uuid

from core.config import BYTES_PER_SEC, DEFAULT_ALIYUN_ASR_API_URL, SAMPLE_RATE
from core.context import TranscriptSessionContext
from core.protocol import TranscriptEmitter
from core.ws_utils import safe_send_json
from providers.base import BaseAsrProvider


log = logging.getLogger("asr")


class AliyunAsrProvider(BaseAsrProvider):
    def __init__(
        self,
        *,
        model_name: str,
        model_dir: str,
        api_url: str,
        api_key: str,
    ):
        super().__init__(name="aliyun", model_name=model_name)
        self.model_dir = model_dir
        self.api_url = api_url
        self.api_key = api_key
        self.model_loaded = False

    async def startup(self) -> None:
        self.model_loaded = True
        log.info(
            f"使用阿里云实时语音识别: model={self.model_name}, "
            f"api_url={self.api_url}, api_key={'已配置' if self.api_key else '未配置'}"
        )

    async def health(self) -> dict:
        return {
            "status": "ok",
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

        target_url = self._build_realtime_url()
        aliyun_ws = await self._connect_ws(target_url)
        event_types = []

        async def read_event(timeout: float = 8.0) -> dict:
            raw = await asyncio.wait_for(aliyun_ws.recv(), timeout=timeout)
            if not isinstance(raw, str):
                return {"type": "binary"}
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                return {"type": "unknown", "raw": raw[:120]}

            event_type = str(event.get("type", ""))
            if event_type:
                event_types.append(event_type)

            if event_type.endswith(".failed") or event_type in {"error", "session.failed"}:
                error = event.get("error")
                if isinstance(error, dict):
                    message = error.get("message") or error.get("code")
                else:
                    message = event.get("message") or error
                raise RuntimeError(str(message or "阿里云实时 ASR 测试失败"))

            return event

        try:
            await aliyun_ws.send(json.dumps(self._build_session_update(), ensure_ascii=False))

            for _ in range(4):
                event = await read_event()
                if event.get("type") == "session.updated":
                    break

            silence = bytes(int(BYTES_PER_SEC * 0.8))
            await aliyun_ws.send(
                json.dumps(
                    {
                        "event_id": str(uuid.uuid4()),
                        "type": "input_audio_buffer.append",
                        "audio": base64.b64encode(silence).decode("ascii"),
                    },
                    ensure_ascii=False,
                )
            )
            await aliyun_ws.send(
                json.dumps(
                    {
                        "event_id": str(uuid.uuid4()),
                        "type": "session.finish",
                    },
                    ensure_ascii=False,
                )
            )

            for _ in range(8):
                event = await read_event(timeout=12.0)
                if event.get("type") == "session.finished":
                    break
            else:
                raise RuntimeError("等待 session.finished 超时")

            return {
                "provider": self.name,
                "model_name": self.model_name,
                "api_url": self.api_url or DEFAULT_ALIYUN_ASR_API_URL,
                "events": event_types,
                "message": "阿里云 ASR WebSocket 会话测试完成",
            }
        finally:
            with contextlib.suppress(Exception):
                await aliyun_ws.close()

    async def handle_ws(self, ws) -> None:
        await ws.accept()

        if not self.api_key:
            await safe_send_json(ws, {"error": "未配置阿里云 DashScope API Key"})
            await ws.close(code=1008)
            return

        try:
            aliyun_ws = await self._connect_ws(self._build_realtime_url())
        except Exception as e:
            log.warning(f"连接阿里云实时 ASR 失败: {e}")
            await safe_send_json(ws, {"error": f"连接阿里云实时 ASR 失败: {e}"})
            await ws.close(code=1011)
            return

        last_partial = ""
        transcript = TranscriptSessionContext(provider=self.name)
        forwarded_chunks = 0
        forwarded_bytes = 0
        last_audio_log_at = 0.0
        emitter = TranscriptEmitter(provider=self.name, log_label="ALIYUN_TRANSCRIPT", send_json=lambda payload: safe_send_json(ws, payload))

        async def forward_audio():
            nonlocal forwarded_chunks, forwarded_bytes, last_audio_log_at
            try:
                while True:
                    message = await ws.receive()
                    if message.get("type") == "websocket.disconnect":
                        break

                    audio = message.get("bytes")
                    if not audio:
                        continue

                    forwarded_chunks += 1
                    forwarded_bytes += len(audio)
                    now = time.time()
                    if now - last_audio_log_at >= 2.0:
                        last_audio_log_at = now
                        log.info(
                            f"[ALIYUN_AUDIO_IN] chunks={forwarded_chunks} forwarded_kb={forwarded_bytes / 1024:.1f}"
                        )

                    await aliyun_ws.send(
                        json.dumps(
                            {
                                "event_id": str(uuid.uuid4()),
                                "type": "input_audio_buffer.append",
                                "audio": base64.b64encode(audio).decode("ascii"),
                            },
                            ensure_ascii=False,
                        )
                    )
            except Exception:
                pass
            finally:
                with contextlib.suppress(Exception):
                    await aliyun_ws.send(
                        json.dumps(
                            {
                                "event_id": str(uuid.uuid4()),
                                "type": "session.finish",
                            },
                            ensure_ascii=False,
                        )
                    )

        async def forward_events():
            nonlocal last_partial
            try:
                async for raw in aliyun_ws:
                    if not isinstance(raw, str):
                        continue

                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    event_type = str(event.get("type", ""))
                    log.info(f"[ALIYUN_EVENT] type={event_type}")
                    if event_type.endswith(".failed") or event_type in {"error", "session.failed"}:
                        error = event.get("error")
                        if isinstance(error, dict):
                            message = error.get("message") or error.get("code")
                        else:
                            message = event.get("message") or error
                        message = message or "阿里云实时 ASR 识别失败"
                        await safe_send_json(ws, {"error": str(message)})
                        continue

                    if "input_audio_transcription" not in event_type:
                        if event_type == "session.finished":
                            break
                        continue

                    text = self._extract_text(event)
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
                            legacy_final=text,
                        ):
                            break
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
                            legacy_partial=text,
                        ):
                            break
            except Exception as e:
                log.info(f"[ALIYUN_STREAM] event_forward_end type={type(e).__name__} error={e}")

        try:
            await aliyun_ws.send(json.dumps(self._build_session_update(), ensure_ascii=False))

            audio_task = asyncio.create_task(forward_audio())
            event_task = asyncio.create_task(forward_events())
            done, pending = await asyncio.wait(
                {audio_task, event_task},
                return_when=asyncio.FIRST_COMPLETED,
            )

            for task in pending:
                task.cancel()
            for task in pending:
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            for task in done:
                with contextlib.suppress(Exception):
                    await task
            if last_partial:
                transcript.ensure_turn_id()
                transcript.ensure_revision()
                transcript.merge_committed(last_partial)
                last_partial = ""
            if transcript.committed_text:
                await emitter.emit(
                    transcript,
                    "session_final",
                    turn_id=transcript.current_turn_id,
                    revision=transcript.revision,
                    is_final_session=True,
                    legacy_final=transcript.committed_text,
                )
            log.info(
                f"[ALIYUN_SESSION] closed forwarded_kb={forwarded_bytes / 1024:.1f} "
                f"committed_len={len(transcript.committed_text)}"
            )
        finally:
            with contextlib.suppress(Exception):
                await aliyun_ws.close()
            with contextlib.suppress(Exception):
                await ws.close()

    def _build_realtime_url(self) -> str:
        base_url = (self.api_url or DEFAULT_ALIYUN_ASR_API_URL).strip()
        parsed = urllib.parse.urlsplit(base_url)
        query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)

        if not any(key == "model" for key, _ in query):
            query.append(("model", self.model_name))

        return urllib.parse.urlunsplit(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                urllib.parse.urlencode(query),
                parsed.fragment,
            )
        )

    async def _connect_ws(self, url: str):
        import websockets

        headers = {"Authorization": f"bearer {self.api_key}"}
        kwargs = {
            "ping_interval": 20,
            "ping_timeout": 20,
            "max_size": 16 * 1024 * 1024,
        }

        try:
            return await websockets.connect(url, additional_headers=headers, **kwargs)
        except TypeError:
            return await websockets.connect(url, extra_headers=headers, **kwargs)

    def _extract_text(self, event: dict) -> str:
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
                    return "".join(texts).strip()

        output = event.get("output")
        if isinstance(output, dict):
            for key in ("transcript", "text"):
                value = output.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()

        return ""

    def _build_session_update(self) -> dict:
        return {
            "event_id": str(uuid.uuid4()),
            "type": "session.update",
            "session": {
                "input_audio_format": "pcm",
                "sample_rate": SAMPLE_RATE,
                "input_audio_transcription": {
                    "language": "zh",
                },
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.0,
                    "silence_duration_ms": 400,
                },
            },
        }
