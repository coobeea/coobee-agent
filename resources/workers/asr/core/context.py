"""ASR transcript 会话上下文。"""

from __future__ import annotations

from dataclasses import dataclass

from core.transcript import merge_transcript_text


@dataclass
class TranscriptSessionContext:
    provider: str
    committed_text: str = ""
    current_turn_id: str = ""
    revision: int = 0
    transcript_seq: int = 0
    turn_count: int = 0

    def next_seq(self) -> int:
        self.transcript_seq += 1
        return self.transcript_seq

    def next_turn_id(self) -> str:
        self.turn_count += 1
        return f"turn-{self.turn_count}"

    def ensure_turn_id(self) -> str:
        if not self.current_turn_id:
            self.current_turn_id = self.next_turn_id()
        return self.current_turn_id

    def bump_revision(self) -> int:
        self.revision += 1
        return self.revision

    def ensure_revision(self, default: int = 1) -> int:
        if self.revision <= 0:
            self.revision = default
        return self.revision

    def reset_turn(self) -> None:
        self.current_turn_id = ""
        self.revision = 0

    def merge_committed(self, text: str) -> str:
        self.committed_text = merge_transcript_text(self.committed_text, text)
        return self.committed_text
