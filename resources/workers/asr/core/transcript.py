"""ASR transcript 公共工具。"""

from __future__ import annotations

import re


def should_insert_space(before: str, after: str) -> bool:
    return bool(re.search(r"[a-zA-Z0-9]$", before)) and bool(re.search(r"^[a-zA-Z0-9]", after))


def find_text_overlap(before: str, after: str, max_chars: int = 200) -> int:
    before_chars = list(before)
    after_chars = list(after)
    max_overlap = min(len(before_chars), len(after_chars), max_chars)

    for length in range(max_overlap, 0, -1):
        if before_chars[-length:] == after_chars[:length]:
            return length

    return 0


def text_similarity(text1: str, text2: str) -> float:
    """计算两个文本的相似度（基于字符集合的 Jaccard 相似度）。"""
    if not text1 or not text2:
        return 0.0
    
    set1 = set(text1)
    set2 = set(text2)
    
    intersection = set1 & set2
    union = set1 | set2
    
    if not union:
        return 0.0
    
    return len(intersection) / len(union)


def merge_transcript_text(before: str, after: str) -> str:
    base = (before or "").strip()
    next_text = (after or "").strip()
    if not base:
        return next_text
    if not next_text or next_text == base or next_text in base:
        return base
    if next_text.startswith(base) or base in next_text:
        return next_text

    # 检查高相似度（可能是重连后的重复识别）
    similarity = text_similarity(base, next_text)
    if similarity > 0.85:
        # 高度相似，保留较长的文本
        return next_text if len(next_text) > len(base) else base

    overlap = find_text_overlap(base, next_text)
    separator = " " if overlap == 0 and should_insert_space(base, next_text) else ""
    return f"{base}{separator}{next_text[overlap:]}"


def get_text_tail(text: str, max_chars: int = 48) -> str:
    chars = list((text or "").strip())
    if len(chars) <= max_chars:
        return "".join(chars)
    return "..." + "".join(chars[-max_chars:])
