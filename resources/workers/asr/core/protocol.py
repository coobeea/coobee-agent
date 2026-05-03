"""ASR transcript 协议输出。"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable

from core.context import TranscriptSessionContext
from core.transcript import get_text_tail, merge_transcript_text


SendJson = Callable[[dict], Awaitable[bool]]

log = logging.getLogger("asr")


class TranscriptEmitter:
    def __init__(self, *, provider: str, log_label: str, send_json: SendJson):
        self.provider = provider
        self.log_label = log_label
        self._send_json = send_json

    async def emit(
        self,
        context: TranscriptSessionContext,
        transcript_event: str,
        *,
        committed: str | None = None,
        draft: str = "",
        turn_id: str | None = None,
        revision: int | None = None,
        is_final_turn: bool = False,
        is_final_session: bool = False,
        legacy_partial: str | None = None,
        legacy_final: str | None = None,
        **payload,
    ) -> bool:
        committed_text = context.committed_text if committed is None else committed
        display_text = merge_transcript_text(committed_text, draft)
        seq = context.next_seq()
        revision_value = context.revision if revision is None else revision

        message = {
            "transcript_event": transcript_event,
            "provider": self.provider,
            "seq": seq,
            "turn_id": turn_id or None,
            "revision": revision_value,
            "committed_text": committed_text,
            "draft_text": draft,
            "display_text": display_text,
            "is_final_turn": is_final_turn,
            "is_final_session": is_final_session,
            **payload,
        }
        if legacy_partial is not None:
            message["partial"] = legacy_partial
        if legacy_final is not None:
            message["final"] = legacy_final

        log.info(
            f"[{self.log_label}] event={transcript_event} seq={seq} turn_id={turn_id or '-'} "
            f"revision={revision_value} committed_len={len(committed_text)} draft_len={len(draft)} "
            f"display_tail={get_text_tail(display_text)}"
        )
        return await self._send_json(message)
