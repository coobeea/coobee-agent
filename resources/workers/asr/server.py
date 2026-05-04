"""
ASR Worker — 实时语音识别服务

FastAPI + WebSocket 服务，封装 FunASR-Nano 模型。
由 RuntimeManager 管理生命周期。

启动方式（由 RuntimeManager 自动调用）：
    python server.py --port 18100

环境变量（由 RuntimeManager 注入）：
    MODEL_DIR          模型存储目录
    MODELSCOPE_CACHE   ModelScope 缓存目录

识别策略（PCM 直传 + VAD 触发）：
    - 浏览器端发送 PCM Int16 LE 16kHz 字节流
    - 服务端用 wave 模块写 WAV 头（<1ms，无需 ffmpeg）
    - VAD 检测说话停顿才触发识别，保证句子完整性
    - 幻觉检测：输出字数超音频时长合理范围则截断
"""

import argparse
import asyncio
import logging
import os
import re
import struct
import sys
import tempfile
import time
import wave
from core.config import (
    ALIYUN_MODEL_NAME,
    API_KEY,
    API_URL,
    BYTES_PER_SAMPLE,
    BYTES_PER_SEC,
    MODEL_DIR,
    MODEL_NAME,
    SAMPLE_RATE,
    SCRIPT_DIR,
    USE_ALIYUN_ASR,
    VERBOSE_LOG,
    local_config_base_dir,
)
from core.logging_utils import configure_asr_logging
from app.provider_registry import ProviderRegistry
from providers.aliyun_provider import AliyunAsrProvider
from providers.local_provider import LocalAsrProvider

os.environ["TQDM_DISABLE"] = "1"
os.environ["FUNASR_DISABLE_PBAR"] = "1"

try:
    from tqdm import tqdm
    from functools import partialmethod
    tqdm.__init__ = partialmethod(tqdm.__init__, disable=True)
except ImportError:
    pass

logging.getLogger("modelscope").setLevel(logging.WARNING)
logging.getLogger("funasr").setLevel(logging.WARNING)

# FastAPI / uvicorn
try:
    from fastapi import FastAPI, WebSocket
    from fastapi.responses import JSONResponse
    import uvicorn
except ImportError:
    print("[ASR Worker] 缺少依赖，请先安装: pip install fastapi uvicorn", file=sys.stderr)
    sys.exit(1)

# ==================== 配置 ====================

log = configure_asr_logging(VERBOSE_LOG)

# 模型类型检测：SenseVoice 系列需要不同的参数和后处理
_is_sensevoice = "sensevoice" in MODEL_NAME.lower().replace("-", "").replace("_", "")

app = FastAPI(title="ASR Worker", version="0.3.0")

# ==================== 全局状态 ====================

asr_engine = None
model_loaded = False
resolved_model_path = None
_provider_registry = None


# ==================== 模型加载 ====================

MODEL_WEIGHT_EXTENSIONS = (".pt", ".bin", ".safetensors", ".onnx")
MODEL_TEMP_DIR_NAMES = {"._____temp", "__pycache__", ".git"}


def normalize_model_path(path: str) -> str:
    """展开用户路径并规范为绝对路径。"""
    return os.path.abspath(os.path.expanduser(path))


def append_unique_path(paths, seen, path: str):
    normalized = normalize_model_path(path)
    if normalized not in seen:
        paths.append(normalized)
        seen.add(normalized)


def collect_local_model_candidates():
    """按优先级收集可能的本地模型路径。"""
    candidates = []
    seen = set()
    model_name_path = os.path.expanduser(MODEL_NAME)

    if os.path.isabs(model_name_path):
        append_unique_path(candidates, seen, model_name_path)
        return candidates

    append_unique_path(candidates, seen, os.path.join(local_config_base_dir, model_name_path))
    append_unique_path(candidates, seen, os.path.join(MODEL_DIR, model_name_path))
    append_unique_path(candidates, seen, os.path.join(MODEL_DIR, "models", model_name_path))

    modelscope_cache = os.environ.get("MODELSCOPE_CACHE") or MODEL_DIR
    append_unique_path(candidates, seen, os.path.join(modelscope_cache, model_name_path))
    append_unique_path(candidates, seen, os.path.join(modelscope_cache, "models", model_name_path))

    hf_cache = os.environ.get("HUGGINGFACE_HUB_CACHE") or os.path.join(MODEL_DIR, "hub")
    hf_model_dir = f"models--{model_name_path.replace('/', '--')}"
    append_unique_path(candidates, seen, os.path.join(hf_cache, hf_model_dir))

    return candidates


def has_model_weight_file(path: str) -> bool:
    if os.path.isfile(path):
        return path.lower().endswith(MODEL_WEIGHT_EXTENSIONS)

    if not os.path.isdir(path):
        return False

    try:
        for _root, dirs, files in os.walk(path):
            dirs[:] = [name for name in dirs if name not in MODEL_TEMP_DIR_NAMES and not name.startswith("._____")]
            for filename in files:
                if filename.lower().endswith(MODEL_WEIGHT_EXTENSIONS):
                    return True
    except OSError as exc:
        log.warning(f"检查模型目录失败: {path} ({exc})")

    return False


def is_complete_local_model_path(path: str) -> bool:
    return os.path.exists(path) and has_model_weight_file(path)


def resolve_local_model_path():
    incomplete_paths = []

    for candidate in collect_local_model_candidates():
        if is_complete_local_model_path(candidate):
            return candidate
        if os.path.exists(candidate):
            incomplete_paths.append(candidate)

    for path in incomplete_paths:
        log.warning(f"发现本地模型目录但权重未完整下载，暂不使用: {path}")

    return None


def detect_device() -> str:
    """自动选择最佳计算设备"""
    import torch
    if torch.cuda.is_available():
        return "cuda:0"
    elif torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_asr_model():
    """加载 FunASR 模型"""
    global asr_engine, model_loaded, resolved_model_path

    from funasr import AutoModel

    device = detect_device()

    log.info(f"加载模型: {MODEL_NAME}")
    log.info(f"设备: {device}")
    log.info(f"模型目录: {MODEL_DIR}")

    os.environ["MODELSCOPE_CACHE"] = MODEL_DIR
    os.environ["HF_HOME"] = MODEL_DIR
    os.environ["HUGGINGFACE_HUB_CACHE"] = os.path.join(MODEL_DIR, "hub")

    resolved_model_path = resolve_local_model_path()
    if resolved_model_path:
        print(f"[ASR Worker] 使用本地模型路径: {resolved_model_path}")
        model_arg = resolved_model_path
    else:
        print(f"[ASR Worker] 未找到完整本地模型缓存，将通过 ModelScope 加载: {MODEL_NAME}")
        model_arg = MODEL_NAME

    # remote_code 仅用于 Fun-ASR-Nano（自定义模型实现）
    needs_remote_code = "fun-asr-nano" in MODEL_NAME.lower().replace("_", "-")
    model_kwargs = dict(
        model=model_arg,
        trust_remote_code=True,
        device=device,
        hub="ms",
        disable_update=True,
        log_level="ERROR",
    )
    if needs_remote_code:
        model_py_path = os.path.join(SCRIPT_DIR, "model.py")
        model_kwargs["remote_code"] = model_py_path

    t0 = time.time()
    asr_engine = AutoModel(**model_kwargs)
    if not resolved_model_path:
        resolved_model_path = resolve_local_model_path()
    
    # 屏蔽 FunASR 的繁琐日志
    logging.getLogger("funasr").setLevel(logging.ERROR)
    
    elapsed = time.time() - t0
    model_loaded = True
    log.info(f"模型加载完成，耗时 {elapsed:.1f}s")


async def startup_local_provider() -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, load_asr_model)


def build_provider_registry() -> ProviderRegistry:
    registry = ProviderRegistry()
    registry.register(
        AliyunAsrProvider(
            model_name=ALIYUN_MODEL_NAME,
            model_dir=MODEL_DIR,
            api_url=API_URL,
            api_key=API_KEY,
        )
    )
    registry.register(
        LocalAsrProvider(
            model_name=MODEL_NAME,
            model_dir=MODEL_DIR,
            get_model_loaded=lambda: model_loaded,
            get_resolved_model_path=lambda: resolved_model_path,
            startup_cb=startup_local_provider,
            transcribe_cb=transcribe_async,
            chunk_energy_cb=check_chunk_energy,
        )
    )
    return registry


def get_provider_registry() -> ProviderRegistry:
    global _provider_registry
    if _provider_registry is None:
        _provider_registry = build_provider_registry()
    return _provider_registry


def get_active_provider():
    provider_name = "aliyun" if USE_ALIYUN_ASR else "local"
    return get_provider_registry().get(provider_name)


@app.on_event("startup")
async def startup_event():
    """应用启动时加载当前 provider（在线程池中执行，不阻塞事件循环）"""
    await get_active_provider().startup()


# ==================== HTTP 接口 ====================

@app.get("/health")
async def health():
    """健康检查"""
    resp = await get_active_provider().health()
    return JSONResponse(resp)


@app.post("/api/test")
async def test_asr(_request: dict = None):
    """
    实际测试 ASR Worker。

    - 本地模型：执行一次短静音推理，验证模型与推理链路可用。
    - 阿里云模型：真实建立 WebSocket 会话，发送 session.update / 音频 / session.finish。
    """
    started_at = time.time()
    provider = get_active_provider()

    try:
        result = await provider.run_test()
        result["ok"] = True
        result["latency_ms"] = int((time.time() - started_at) * 1000)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse(
            {
                "ok": False,
                "provider": provider.name,
                "model_name": provider.model_name,
                "latency_ms": int((time.time() - started_at) * 1000),
                "error": str(e),
            },
            status_code=500,
        )


# ==================== 音频处理 ====================

def pcm_to_wav(pcm_bytes: bytes, tmp_dir: str) -> str:
    """
    PCM Int16 LE → WAV 文件（极快，无需 ffmpeg）
    
    Args:
        pcm_bytes: PCM Int16 LE 字节流（16kHz 单声道）
        tmp_dir: 临时目录
    
    Returns:
        WAV 文件路径
    """
    wav_path = os.path.join(tmp_dir, "segment.wav")
    
    with wave.open(wav_path, "wb") as wf:
        wf.setnchannels(1)          # 单声道
        wf.setsampwidth(BYTES_PER_SAMPLE)  # 2 bytes (Int16)
        wf.setframerate(SAMPLE_RATE)       # 16000 Hz
        wf.writeframes(pcm_bytes)
    
    return wav_path


_SENSEVOICE_TAG_RE = re.compile(r"<\|([^|]*)\|>")

# SenseVoice 标签值域映射
_LANG_TAGS = {"zh", "en", "yue", "ja", "ko", "nospeech"}
_EMOTION_TAGS = {"NEUTRAL", "HAPPY", "SAD", "ANGRY", "EMO_UNKNOWN"}
_EVENT_TAGS = {"Speech", "BGM", "Applause", "Laughter", "Crying", "Coughing", "Sneezing"}
_ITN_TAGS = {"withitn", "woitn"}


def parse_sensevoice_output(raw_text: str) -> dict:
    """
    解析 SenseVoice 模型输出，提取结构化元数据。
    
    Returns:
        {
            "text": "纯文本内容",
            "lang": "zh" | "en" | "yue" | "ja" | "ko" | "nospeech" | None,
            "emotion": "NEUTRAL" | "HAPPY" | "SAD" | "ANGRY" | None,
            "event": "Speech" | "BGM" | "Laughter" | ... | None,
        }
    """
    meta = {"lang": None, "emotion": None, "event": None}
    
    for match in _SENSEVOICE_TAG_RE.finditer(raw_text):
        tag = match.group(1)
        if tag in _LANG_TAGS:
            meta["lang"] = tag
        elif tag in _EMOTION_TAGS:
            meta["emotion"] = tag if tag != "EMO_UNKNOWN" else None
        elif tag in _EVENT_TAGS:
            meta["event"] = tag
        # ITN 标签忽略，不需要传给前端

    text = _SENSEVOICE_TAG_RE.sub("", raw_text).strip()
    return {"text": text, **meta}


def clean_asr_output(text: str, audio_sec: float) -> str:
    """幻觉检测：输出字数超音频时长合理范围则截断"""
    if not text:
        return text
    
    max_chars = max(int(audio_sec * 15), 10)
    if len(text) > max_chars:
        log.warning(
            f"幻觉检测: {len(text)} 字/{audio_sec:.1f}s 音频 → 截断到 {max_chars} 字"
        )
        text = text[:max_chars]
    
    return text


def check_chunk_energy(data: bytes) -> int:
    """
    快速检测音频 chunk 的峰值振幅（采样 50 个点）
    
    Args:
        data: PCM Int16 LE 字节流
    
    Returns:
        峰值振幅（0-32767）
    """
    n_samples = len(data) // BYTES_PER_SAMPLE
    if n_samples == 0:
        return 0
    
    check_count = min(50, n_samples)
    step = max(1, n_samples // check_count)
    max_amp = 0
    
    for i in range(0, n_samples, step):
        val = abs(struct.unpack_from("<h", data, i * BYTES_PER_SAMPLE)[0])
        if val > max_amp:
            max_amp = val
    
    return max_amp


def do_transcribe(pcm_bytes: bytes) -> dict:
    """
    同步识别，返回结构化结果。
    
    Returns:
        {
            "text": str,          # 纯文本
            "latency_ms": int,
            "lang": str | None,   # SenseVoice: 语言
            "emotion": str | None,# SenseVoice: 情感
            "event": str | None,  # SenseVoice: 声音事件
        }
    """
    empty = {"text": "", "latency_ms": 0, "lang": None, "emotion": None, "event": None}
    if not asr_engine or not pcm_bytes:
        return empty
    
    seg_sec = len(pcm_bytes) / BYTES_PER_SEC
    
    with tempfile.TemporaryDirectory(prefix="asr_") as tmp:
        t0 = time.time()
        wav_path = pcm_to_wav(pcm_bytes, tmp)
        wav_ms = int((time.time() - t0) * 1000)
        
        t1 = time.time()
        if _is_sensevoice:
            results = asr_engine.generate(
                input=wav_path,
                cache={},
                language="auto",
                use_itn=True,
                batch_size_s=0,
                disable_pbar=True,
            )
        else:
            results = asr_engine.generate(
                input=[wav_path],
                cache={},
                batch_size=1,
                hotwords=[],
                language="中文",
                itn=True,
                disable_pbar=True,
                log_level="ERROR",
            )
        infer_ms = int((time.time() - t1) * 1000)
        
        raw_text = ""
        if results and len(results) > 0:
            raw_text = results[0].get("text", "").strip()
        
        meta = {"lang": None, "emotion": None, "event": None}
        if _is_sensevoice and raw_text:
            parsed = parse_sensevoice_output(raw_text)
            text = parsed["text"]
            meta = {"lang": parsed["lang"], "emotion": parsed["emotion"], "event": parsed["event"]}
        else:
            text = raw_text
        
        text = clean_asr_output(text, seg_sec)
        
        total_ms = wav_ms + infer_ms
        return {"text": text, "latency_ms": total_ms, **meta}


async def transcribe_async(pcm_bytes: bytes) -> dict:
    """异步版本：在线程池中执行识别"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, do_transcribe, pcm_bytes)


# ==================== WebSocket 流式 ASR ====================


@app.websocket("/ws/asr")
async def asr_stream(ws: WebSocket):
    await get_active_provider().handle_ws(ws)


# ==================== 启动 ====================

def main():
    parser = argparse.ArgumentParser(description="ASR Worker Server")
    parser.add_argument("--port", type=int, default=18100, help="服务端口")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="绑定地址")
    args = parser.parse_args()

    print(f"[ASR Worker] 启动服务 {args.host}:{args.port}")

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
