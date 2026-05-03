"""ASR Worker 通用日志工具。"""

from __future__ import annotations

import logging


def configure_asr_logging(verbose: bool) -> logging.Logger:
    logging.basicConfig(level=logging.WARNING, format="[ASR] %(message)s")
    log = logging.getLogger("asr")
    log.setLevel(logging.WARNING)

    if verbose:
        logging.getLogger().setLevel(logging.INFO)
        log.setLevel(logging.INFO)

    return log
