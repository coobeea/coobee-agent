"""ASR Worker 通用配置与常量。"""

from __future__ import annotations

import json
import os


SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ALIYUN_REALTIME_API_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
DEFAULT_ALIYUN_INFERENCE_API_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/inference"

# 默认路径
DEFAULT_MODEL_DIR = os.path.join(os.environ.get("HOME", ""), ".cache", "modelscope", "hub")
MODEL_DIR = os.environ.get("MODEL_DIR", DEFAULT_MODEL_DIR)
MODEL_NAME = "FunAudioLLM/Fun-ASR-Nano-2512"
API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
API_URL = ""

# 尝试读取运行时配置覆盖 (WORKER_CONFIG_PATH)，local_config.json 仅作兼容兜底
local_config_path = os.environ.get("WORKER_CONFIG_PATH") or os.path.join(SCRIPT_DIR, "local_config.json")
local_config_base_dir = os.path.dirname(os.path.abspath(local_config_path))
if os.path.exists(local_config_path):
    try:
        with open(local_config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        if isinstance(config, dict):
            if "model_dir" in config and isinstance(config["model_dir"], str):
                model_dir = config["model_dir"]
                if not os.path.isabs(model_dir):
                    model_dir = os.path.abspath(os.path.join(local_config_base_dir, model_dir))
                MODEL_DIR = model_dir

            if "model_name" in config and isinstance(config["model_name"], str) and config["model_name"].strip():
                MODEL_NAME = config["model_name"].strip()

            if "api_key" in config and isinstance(config["api_key"], str) and config["api_key"].strip():
                API_KEY = config["api_key"].strip()

            if "api_url" in config and isinstance(config["api_url"], str) and config["api_url"].strip():
                API_URL = config["api_url"].strip()
    except Exception:
        pass

# PCM 音频参数
SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2  # Int16
BYTES_PER_SEC = SAMPLE_RATE * BYTES_PER_SAMPLE  # 32000

# ---- VAD（语音活动检测）参数 ----
SILENCE_THRESHOLD = 300       # Int16 振幅阈值，低于此视为静音
SILENCE_DURATION_SEC = 1.2    # 连续静音多久才算"说完一句"
MAX_UTTERANCE_SEC = 20.0      # 不间断说话的安全上限（超过强制识别）
MIN_UTTERANCE_SEC = 0.3       # 最短有效语段（低于此不值得识别）

VERBOSE_LOG = os.environ.get("ASR_VERBOSE_LOG", "1").strip().lower() not in {"0", "false", "off", "no"}

USE_ALIYUN_ASR = MODEL_NAME.lower().startswith("aliyun/")
ALIYUN_MODEL_NAME = MODEL_NAME.split("/", 1)[1] if USE_ALIYUN_ASR and "/" in MODEL_NAME else MODEL_NAME


def get_default_aliyun_api_url(model_name: str) -> str:
    normalized = (model_name or "").strip().lower()
    if normalized.startswith("aliyun/"):
        normalized = normalized.split("/", 1)[1]

    if normalized.startswith("qwen3-") and normalized.endswith("-realtime"):
        return DEFAULT_ALIYUN_REALTIME_API_URL

    if normalized.endswith("-realtime"):
        return DEFAULT_ALIYUN_INFERENCE_API_URL

    return DEFAULT_ALIYUN_REALTIME_API_URL


if USE_ALIYUN_ASR and not API_URL:
    API_URL = get_default_aliyun_api_url(ALIYUN_MODEL_NAME)
elif not API_URL:
    API_URL = DEFAULT_ALIYUN_REALTIME_API_URL
