"""本地 ASR provider。"""

from __future__ import annotations

import asyncio
import logging
import time

from fastapi import WebSocketDisconnect

from core.config import (
    BYTES_PER_SEC,
    MAX_UTTERANCE_SEC,
    MIN_UTTERANCE_SEC,
    SILENCE_DURATION_SEC,
    SILENCE_THRESHOLD,
)
from core.context import TranscriptSessionContext
from core.protocol import TranscriptEmitter
from core.transcript import get_text_tail
from providers.base import BaseAsrProvider


log = logging.getLogger("asr")

MAX_UTTERANCE_BYTES = int(MAX_UTTERANCE_SEC * BYTES_PER_SEC)
MIN_UTTERANCE_BYTES = int(MIN_UTTERANCE_SEC * BYTES_PER_SEC)
SILENCE_BYTES = int(SILENCE_DURATION_SEC * BYTES_PER_SEC)


class LocalAsrProvider(BaseAsrProvider):
    def __init__(
        self,
        *,
        model_name: str,
        model_dir: str,
        get_model_loaded,
        get_resolved_model_path,
        startup_cb,
        transcribe_cb,
        chunk_energy_cb,
    ):
        super().__init__(name="local", model_name=model_name)
        self.model_dir = model_dir
        self._get_model_loaded = get_model_loaded
        self._get_resolved_model_path = get_resolved_model_path
        self._startup_cb = startup_cb
        self._transcribe_cb = transcribe_cb
        self._chunk_energy_cb = chunk_energy_cb

    async def startup(self) -> None:
        await self._startup_cb()

    async def health(self) -> dict:
        return {
            "status": "ok",
            "model_loaded": self._get_model_loaded(),
            "provider": self.name,
            "model_name": self.model_name,
            "model_dir": self.model_dir,
            "resolved_model_path": self._get_resolved_model_path(),
        }

    async def run_test(self) -> dict:
        if not self._get_model_loaded():
            raise RuntimeError("ASR 模型尚未加载完成")

        seconds = 0.8
        pcm_bytes = bytes(int(BYTES_PER_SEC * seconds))
        transcribe_result = await self._transcribe_cb(pcm_bytes)
        return {
            "provider": self.name,
            "model_name": self.model_name,
            "sample_seconds": seconds,
            "text": transcribe_result.get("text", ""),
            "inference_latency_ms": transcribe_result.get("latency_ms", 0),
            "message": "本地 ASR 推理链路测试完成",
        }

    async def handle_ws(self, ws) -> None:
        await ws.accept()
        log.debug("WebSocket 客户端已连接")

        if not self._get_model_loaded():
            await ws.send_json({"status": "loading", "message": "模型加载中..."})
            while not self._get_model_loaded():
                await asyncio.sleep(0.5)
        await ws.send_json({"status": "ready", "message": "模型已就绪"})

        buffer = bytearray()
        recognized_pos = 0
        connected = True
        pending = asyncio.Event()
        send_lock = asyncio.Lock()
        last_status_sent_at = 0.0
        transcript = TranscriptSessionContext(provider=self.name)
        received_chunks = 0
        received_bytes = 0
        last_chunk_log_at = 0.0

        speech_start_pos = -1
        silence_start_pos = -1

        async def send_json(payload: dict) -> bool:
            try:
                async with send_lock:
                    await ws.send_json(payload)
                return True
            except Exception:
                return False

        async def send_asr_status(asr_status: str, throttle_ms: int = 0, **payload) -> bool:
            nonlocal last_status_sent_at

            now = time.time()
            if throttle_ms > 0 and (now - last_status_sent_at) * 1000 < throttle_ms:
                return True

            last_status_sent_at = now
            message = {
                "asr_status": asr_status,
                **payload,
            }
            log.info(
                f"[ASR_STATUS] status={asr_status} "
                f"buffered_ms={payload.get('buffered_ms')} latency_ms={payload.get('latency_ms')} "
                f"energy={payload.get('energy')} text_tail={payload.get('text_tail')}"
            )
            return await send_json(message)

        emitter = TranscriptEmitter(provider=self.name, log_label="TRANSCRIPT", send_json=send_json)

        async def receive_chunks():
            nonlocal connected, speech_start_pos, silence_start_pos, recognized_pos
            nonlocal received_chunks, received_bytes, last_chunk_log_at

            try:
                while True:
                    data = await ws.receive_bytes()
                    buf_pos_before = len(buffer)
                    buffer.extend(data)
                    received_chunks += 1
                    received_bytes += len(data)

                    energy = self._chunk_energy_cb(data)
                    is_speech = energy > SILENCE_THRESHOLD
                    now = time.time()
                    if now - last_chunk_log_at >= 2.0:
                        last_chunk_log_at = now
                        log.info(
                            f"[AUDIO_IN] chunks={received_chunks} recv_kb={received_bytes / 1024:.1f} "
                            f"buffer_kb={len(buffer) / 1024:.1f} recognized_kb={recognized_pos / 1024:.1f} "
                            f"energy={energy} speech={is_speech}"
                        )

                    if is_speech:
                        if speech_start_pos < 0:
                            speech_start_pos = buf_pos_before
                            margin = int(0.2 * BYTES_PER_SEC)
                            skip_to = max(recognized_pos, buf_pos_before - margin)
                            if skip_to > recognized_pos:
                                recognized_pos = skip_to
                            log.info(
                                f"[VAD] speech_start pos={speech_start_pos} "
                                f"recognized_pos={recognized_pos} energy={energy}"
                            )
                            if not await send_asr_status("speech_start", energy=energy):
                                break
                        else:
                            speech_ms = int((len(buffer) - speech_start_pos) / BYTES_PER_SEC * 1000)
                            if not await send_asr_status(
                                "speech_active",
                                throttle_ms=500,
                                buffered_ms=speech_ms,
                                energy=energy,
                            ):
                                break
                        silence_start_pos = -1

                        speech_len = len(buffer) - speech_start_pos
                        if speech_len >= MAX_UTTERANCE_BYTES:
                            log.info(
                                f"[VAD] force_recognize speech_sec={speech_len / BYTES_PER_SEC:.1f} "
                                f"buffer_kb={len(buffer) / 1024:.1f}"
                            )
                            pending.set()
                    else:
                        if silence_start_pos < 0:
                            silence_start_pos = buf_pos_before

                        if speech_start_pos >= 0:
                            silence_len = len(buffer) - silence_start_pos
                            if silence_len >= SILENCE_BYTES:
                                utterance_bytes = silence_start_pos - recognized_pos
                                utterance_ms = int(utterance_bytes / BYTES_PER_SEC * 1000)
                                log.info(
                                    f"[VAD] speech_end utterance_ms={utterance_ms} "
                                    f"utterance_sec={utterance_bytes / BYTES_PER_SEC:.1f}"
                                )
                                if utterance_bytes >= MIN_UTTERANCE_BYTES:
                                    if not await send_asr_status("speech_end", buffered_ms=utterance_ms):
                                        break
                                    pending.set()
                                else:
                                    recognized_pos = len(buffer)
                                speech_start_pos = -1
                                silence_start_pos = -1

            except (WebSocketDisconnect, Exception) as e:
                log.info(f"[ASR_WS] disconnected type={type(e).__name__}")
                connected = False
                pending.set()

        async def recognize_loop():
            nonlocal recognized_pos, speech_start_pos

            while connected:
                await pending.wait()
                pending.clear()

                if not connected:
                    break

                available = len(buffer) - recognized_pos
                if available < MIN_UTTERANCE_BYTES:
                    log.info(
                        f"[RECOGNIZE] skip available_ms={int(available / BYTES_PER_SEC * 1000)} "
                        f"reason=segment_too_short"
                    )
                    continue

                end = min(recognized_pos + MAX_UTTERANCE_BYTES, len(buffer))
                segment = bytes(buffer[recognized_pos:end])
                segment_ms = int(len(segment) / BYTES_PER_SEC * 1000)

                try:
                    if not await send_asr_status("recognizing", buffered_ms=segment_ms):
                        break

                    log.info(
                        f"[RECOGNIZE] start segment_ms={segment_ms} "
                        f"start_pos={recognized_pos} end_pos={end} buffer_kb={len(buffer) / 1024:.1f}"
                    )

                    result = await self._transcribe_cb(segment)
                    recognized_pos = end

                    if speech_start_pos >= 0 and speech_start_pos < end:
                        speech_start_pos = end

                    text = result["text"]
                    if text:
                        turn_id = transcript.next_turn_id()
                        transcript.current_turn_id = turn_id
                        transcript.bump_revision()
                        transcript.merge_committed(text)
                        msg = {"latency_ms": result["latency_ms"]}
                        if result.get("lang"):
                            msg["lang"] = result["lang"]
                        if result.get("emotion"):
                            msg["emotion"] = result["emotion"]
                        if result.get("event"):
                            msg["event"] = result["event"]
                        if not await emitter.emit(
                            transcript,
                            "turn_final",
                            turn_id=turn_id,
                            revision=transcript.revision,
                            draft="",
                            is_final_turn=True,
                            **msg,
                        ):
                            break
                        if not await send_asr_status(
                            "recognized",
                            text_tail=transcript.committed_text[-32:],
                            latency_ms=result["latency_ms"],
                        ):
                            break
                        log.info(
                            f"[RECOGNIZE] done latency_ms={result['latency_ms']} "
                            f"text_len={len(text)} text_tail={get_text_tail(text)}"
                        )
                    else:
                        log.info(
                            f"[RECOGNIZE] done latency_ms={result['latency_ms']} text_len=0 text_tail="
                        )

                except Exception as e:
                    log.warning(f"识别异常: {e}")

        recv_task = asyncio.create_task(receive_chunks())
        recog_task = asyncio.create_task(recognize_loop())

        await recv_task
        connected = False
        pending.set()
        recog_task.cancel()
        try:
            await recog_task
        except asyncio.CancelledError:
            pass

        remaining = len(buffer) - recognized_pos
        if remaining > MIN_UTTERANCE_BYTES:
            segment = bytes(buffer[recognized_pos:])
            try:
                log.info(
                    f"[RECOGNIZE] final_flush segment_ms={int(len(segment) / BYTES_PER_SEC * 1000)} "
                    f"remaining_kb={remaining / 1024:.1f}"
                )
                result = await self._transcribe_cb(segment)
                if result["text"]:
                    transcript.merge_committed(result["text"])
            except Exception:
                pass

        if transcript.committed_text:
            transcript.bump_revision()
            await emitter.emit(
                transcript,
                "session_final",
                is_final_session=True,
            )

        log.info(
            f"[ASR_SESSION] closed total_kb={len(buffer) / 1024:.1f} "
            f"recognized_kb={recognized_pos / 1024:.1f} committed_len={len(transcript.committed_text)}"
        )
