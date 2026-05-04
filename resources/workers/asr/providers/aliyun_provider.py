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

from core.config import (
    BYTES_PER_SEC,
    SAMPLE_RATE,
    get_default_aliyun_api_url,
)
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
        protocol = "qwen-realtime" if self._uses_qwen_protocol() else "asr-task"
        log.info(
            f"使用阿里云实时语音识别: model={self.model_name}, "
            f"api_url={self._get_effective_api_url()}, protocol={protocol}, "
            f"api_key={'已配置' if self.api_key else '未配置'}"
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
            "api_url": self._get_effective_api_url(),
        }

    async def run_test(self) -> dict:
        if not self.api_key:
            raise RuntimeError("未配置阿里云 DashScope API Key")

        if self._uses_qwen_protocol():
            return await self._run_test_qwen()
        return await self._run_test_task_protocol()

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

        try:
            if self._uses_qwen_protocol():
                await self._handle_qwen_ws(ws, aliyun_ws)
            else:
                await self._handle_task_protocol_ws(ws, aliyun_ws)
        finally:
            with contextlib.suppress(Exception):
                await aliyun_ws.close()
            with contextlib.suppress(Exception):
                await ws.close()

    async def _run_test_qwen(self) -> dict:
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
                raise RuntimeError(self._get_qwen_error_message(event))

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
                "api_url": self._get_effective_api_url(),
                "events": event_types,
                "message": "阿里云 ASR WebSocket 会话测试完成",
            }
        finally:
            with contextlib.suppress(Exception):
                await aliyun_ws.close()

    async def _run_test_task_protocol(self) -> dict:
        target_url = self._build_realtime_url()
        aliyun_ws = await self._connect_ws(target_url)
        task_id = self._create_task_id()
        event_types = []

        async def read_event(timeout: float = 8.0) -> dict:
            raw = await asyncio.wait_for(aliyun_ws.recv(), timeout=timeout)
            if not isinstance(raw, str):
                return {"type": "binary"}
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                return {"type": "unknown", "raw": raw[:120]}

            event_type = self._get_task_event_type(event)
            if event_type:
                event_types.append(event_type)

            if event_type in {"task-failed", "error"}:
                raise RuntimeError(self._get_task_protocol_error_message(event))

            return event

        try:
            await aliyun_ws.send(json.dumps(self._build_task_run_message(task_id), ensure_ascii=False))

            for _ in range(6):
                event = await read_event()
                if self._get_task_event_type(event) == "task-started":
                    break
            else:
                raise RuntimeError("等待 task-started 超时")

            await aliyun_ws.send(bytes(int(BYTES_PER_SEC * 0.8)))
            await aliyun_ws.send(json.dumps(self._build_task_finish_message(task_id), ensure_ascii=False))

            for _ in range(10):
                event = await read_event(timeout=12.0)
                if self._get_task_event_type(event) == "task-finished":
                    break
            else:
                raise RuntimeError("等待 task-finished 超时")

            return {
                "provider": self.name,
                "model_name": self.model_name,
                "api_url": self._get_effective_api_url(),
                "events": event_types,
                "message": "阿里云 ASR Task 协议测试完成",
            }
        finally:
            with contextlib.suppress(Exception):
                await aliyun_ws.close()

    async def _handle_qwen_ws(self, ws, aliyun_ws) -> None:
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

    async def _handle_task_protocol_ws(self, ws, aliyun_ws) -> None:
        last_partial = ""
        transcript = TranscriptSessionContext(provider=self.name)
        forwarded_chunks = 0
        forwarded_bytes = 0
        last_audio_log_at = 0.0
        task_id = self._create_task_id()
        emitter = TranscriptEmitter(provider=self.name, log_label="ALIYUN_TRANSCRIPT", send_json=lambda payload: safe_send_json(ws, payload))

        await aliyun_ws.send(json.dumps(self._build_task_run_message(task_id), ensure_ascii=False))
        await self._wait_for_task_started(aliyun_ws)

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

                    await aliyun_ws.send(audio)
            except Exception:
                pass
            finally:
                with contextlib.suppress(Exception):
                    await aliyun_ws.send(json.dumps(self._build_task_finish_message(task_id), ensure_ascii=False))

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

                    event_type = self._get_task_event_type(event)
                    log.info(f"[ALIYUN_EVENT] type={event_type}")
                    if event_type in {"task-failed", "error"}:
                        await safe_send_json(ws, {"error": self._get_task_protocol_error_message(event)})
                        continue

                    if event_type == "task-finished":
                        break

                    if event_type != "result-generated":
                        continue

                    text = self._extract_task_protocol_text(event)
                    if not text:
                        continue

                    if self._is_task_protocol_sentence_end(event):
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

    def _build_realtime_url(self) -> str:
        base_url = self._get_effective_api_url().strip()
        parsed = urllib.parse.urlsplit(base_url)
        if not self._uses_qwen_protocol():
            return urllib.parse.urlunsplit(parsed)

        query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        if not any(key == "model" for key, _ in query):
            query.append(("model", self.model_name))

        return urllib.parse.urlunsplit(
            (parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(query), parsed.fragment)
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

    def _get_effective_api_url(self) -> str:
        return (self.api_url or get_default_aliyun_api_url(self.model_name)).strip()

    def _uses_qwen_protocol(self) -> bool:
        normalized = self.model_name.strip().lower()
        return normalized.startswith("qwen3-")

    def _create_task_id(self) -> str:
        return uuid.uuid4().hex[:32]

    def _build_task_run_message(self, task_id: str) -> dict:
        return {
            "header": {
                "action": "run-task",
                "task_id": task_id,
                "streaming": "duplex",
            },
            "payload": {
                "task_group": "audio",
                "task": "asr",
                "function": "recognition",
                "model": self.model_name,
                "parameters": {
                    "format": "pcm",
                    "sample_rate": SAMPLE_RATE,
                },
                "input": {},
            },
        }

    def _build_task_finish_message(self, task_id: str) -> dict:
        return {
            "header": {
                "action": "finish-task",
                "task_id": task_id,
                "streaming": "duplex",
            },
            "payload": {
                "input": {},
            },
        }

    async def _wait_for_task_started(self, aliyun_ws) -> None:
        for _ in range(6):
            raw = await asyncio.wait_for(aliyun_ws.recv(), timeout=8.0)
            if not isinstance(raw, str):
                continue
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                continue

            event_type = self._get_task_event_type(event)
            log.info(f"[ALIYUN_EVENT] type={event_type}")
            if event_type == "task-started":
                return
            if event_type in {"task-failed", "error"}:
                raise RuntimeError(self._get_task_protocol_error_message(event))

        raise RuntimeError("等待阿里云 task-started 超时")

    def _get_task_event_type(self, event: dict) -> str:
        header = event.get("header")
        if isinstance(header, dict):
            value = header.get("event")
            if isinstance(value, str):
                return value
        value = event.get("type")
        return value if isinstance(value, str) else ""

    def _get_qwen_error_message(self, event: dict) -> str:
        error = event.get("error")
        if isinstance(error, dict):
            message = error.get("message") or error.get("code")
        else:
            message = event.get("message") or error
        return str(message or "阿里云实时 ASR 测试失败")

    def _get_task_protocol_error_message(self, event: dict) -> str:
        header = event.get("header")
        if isinstance(header, dict):
            return str(header.get("error_message") or header.get("error_code") or "阿里云实时 ASR 识别失败")
        payload = event.get("payload")
        if isinstance(payload, dict):
            return str(payload.get("message") or "阿里云实时 ASR 识别失败")
        return "阿里云实时 ASR 识别失败"

    def _extract_task_protocol_text(self, event: dict) -> str:
        payload = event.get("payload")
        if not isinstance(payload, dict):
            return ""

        output = payload.get("output")
        if not isinstance(output, dict):
            return ""

        sentence = output.get("sentence")
        if not isinstance(sentence, dict):
            return ""

        text = sentence.get("text")
        return text.strip() if isinstance(text, str) else ""

    def _is_task_protocol_sentence_end(self, event: dict) -> bool:
        payload = event.get("payload")
        if not isinstance(payload, dict):
            return False

        output = payload.get("output")
        if not isinstance(output, dict):
            return False

        sentence = output.get("sentence")
        if not isinstance(sentence, dict):
            return False

        for key in ("sentence_end", "is_sentence_end", "end", "is_final"):
            if isinstance(sentence.get(key), bool):
                return bool(sentence.get(key))
        return False

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
