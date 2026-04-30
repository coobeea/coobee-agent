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
import base64
import contextlib
import json
import logging
import os
import re
import struct
import sys
import tempfile
import time
import urllib.parse
import uuid
import wave

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
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.responses import JSONResponse
    import uvicorn
except ImportError:
    print("[ASR Worker] 缺少依赖，请先安装: pip install fastapi uvicorn", file=sys.stderr)
    sys.exit(1)

# ==================== 配置 ====================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_NAME = "FunAudioLLM/Fun-ASR-Nano-2512"
DEFAULT_ALIYUN_ASR_API_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"

# 默认路径
DEFAULT_MODEL_DIR = os.path.join(os.environ.get("HOME", ""), ".cache", "modelscope", "hub")
MODEL_DIR = os.environ.get("MODEL_DIR", DEFAULT_MODEL_DIR)
API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
API_URL = DEFAULT_ALIYUN_ASR_API_URL

# 尝试读取运行时配置覆盖 (WORKER_CONFIG_PATH)，local_config.json 仅作兼容兜底
local_config_path = os.environ.get("WORKER_CONFIG_PATH") or os.path.join(SCRIPT_DIR, "local_config.json")
local_config_base_dir = os.path.dirname(os.path.abspath(local_config_path))
if os.path.exists(local_config_path):
    try:
        import json
        with open(local_config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        if isinstance(config, dict):
            if "model_dir" in config and isinstance(config["model_dir"], str):
                p = config["model_dir"]
                if not os.path.isabs(p):
                    p = os.path.abspath(os.path.join(local_config_base_dir, p))
                MODEL_DIR = p

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

logging.basicConfig(level=logging.WARNING, format="[ASR] %(message)s")
log = logging.getLogger("asr")
log.setLevel(logging.WARNING)

# 模型类型检测：SenseVoice 系列需要不同的参数和后处理
_is_sensevoice = "sensevoice" in MODEL_NAME.lower().replace("-", "").replace("_", "")
USE_ALIYUN_QWEN_ASR = MODEL_NAME.lower().startswith("aliyun/")
ALIYUN_MODEL_NAME = MODEL_NAME.split("/", 1)[1] if USE_ALIYUN_QWEN_ASR and "/" in MODEL_NAME else MODEL_NAME

app = FastAPI(title="ASR Worker", version="0.3.0")

# ==================== 全局状态 ====================

asr_engine = None
model_loaded = False
resolved_model_path = None


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
        for root, dirs, files in os.walk(path):
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


@app.on_event("startup")
async def startup_event():
    """应用启动时加载模型（在线程池中执行，不阻塞事件循环）"""
    global model_loaded
    if USE_ALIYUN_QWEN_ASR:
        model_loaded = True
        log.info(
            f"使用阿里云实时语音识别: model={ALIYUN_MODEL_NAME}, "
            f"api_url={API_URL}, api_key={'已配置' if API_KEY else '未配置'}"
        )
        return

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, load_asr_model)


# ==================== HTTP 接口 ====================

@app.get("/health")
async def health():
    """健康检查"""
    resp = {
        "status": "ok",
        "model_loaded": model_loaded,
        "provider": "aliyun" if USE_ALIYUN_QWEN_ASR else "local",
        "model_name": ALIYUN_MODEL_NAME if USE_ALIYUN_QWEN_ASR else MODEL_NAME,
        "model_dir": MODEL_DIR,
        "resolved_model_path": None if USE_ALIYUN_QWEN_ASR else resolved_model_path,
    }
    if USE_ALIYUN_QWEN_ASR:
        resp["api_key_configured"] = bool(API_KEY)
        resp["api_url"] = API_URL
    return JSONResponse(resp)


@app.post("/api/test")
async def test_asr(request: dict = None):
    """
    实际测试 ASR Worker。

    - 本地模型：执行一次短静音推理，验证模型与推理链路可用。
    - 阿里云模型：真实建立 WebSocket 会话，发送 session.update / 音频 / session.finish。
    """
    started_at = time.time()

    try:
        if USE_ALIYUN_QWEN_ASR:
            result = await test_aliyun_asr_session()
        else:
            if not model_loaded:
                raise RuntimeError("ASR 模型尚未加载完成")

            seconds = 0.8
            pcm_bytes = bytes(int(BYTES_PER_SEC * seconds))
            transcribe_result = await transcribe_async(pcm_bytes)
            result = {
                "provider": "local",
                "model_name": MODEL_NAME,
                "sample_seconds": seconds,
                "text": transcribe_result.get("text", ""),
                "inference_latency_ms": transcribe_result.get("latency_ms", 0),
                "message": "本地 ASR 推理链路测试完成",
            }

        result["ok"] = True
        result["latency_ms"] = int((time.time() - started_at) * 1000)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse(
            {
                "ok": False,
                "provider": "aliyun" if USE_ALIYUN_QWEN_ASR else "local",
                "model_name": ALIYUN_MODEL_NAME if USE_ALIYUN_QWEN_ASR else MODEL_NAME,
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


# ==================== 阿里云 Qwen-ASR-Realtime 适配 ====================

def build_aliyun_realtime_url() -> str:
    """构建百炼实时语音识别 WebSocket 地址。"""
    base_url = (API_URL or DEFAULT_ALIYUN_ASR_API_URL).strip()
    parsed = urllib.parse.urlsplit(base_url)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)

    if not any(key == "model" for key, _ in query):
        query.append(("model", ALIYUN_MODEL_NAME))

    return urllib.parse.urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            urllib.parse.urlencode(query),
            parsed.fragment,
        )
    )


async def connect_aliyun_ws(url: str):
    """兼容 websockets 14+ 的 additional_headers 与旧版 extra_headers。"""
    import websockets

    headers = {"Authorization": f"bearer {API_KEY}"}
    kwargs = {
        "ping_interval": 20,
        "ping_timeout": 20,
        "max_size": 16 * 1024 * 1024,
    }

    try:
        return await websockets.connect(url, additional_headers=headers, **kwargs)
    except TypeError:
        return await websockets.connect(url, extra_headers=headers, **kwargs)


def extract_aliyun_text(event: dict) -> str:
    """从百炼实时识别事件中提取文本，兼容 delta/completed 的不同字段形态。"""
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


def build_aliyun_session_update() -> dict:
    """构建百炼实时识别 session 配置。前端仍然固定发送 16k PCM。"""
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


async def safe_send_json(ws: WebSocket, payload: dict) -> bool:
    try:
        await ws.send_json(payload)
        return True
    except Exception:
        return False


async def test_aliyun_asr_session() -> dict:
    """真实建立一次百炼 Qwen-ASR-Realtime 会话，验证配置和协议链路。"""
    if not API_KEY:
        raise RuntimeError("未配置阿里云 DashScope API Key")

    target_url = build_aliyun_realtime_url()
    aliyun_ws = await connect_aliyun_ws(target_url)
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
        await aliyun_ws.send(json.dumps(build_aliyun_session_update(), ensure_ascii=False))

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
            "provider": "aliyun",
            "model_name": ALIYUN_MODEL_NAME,
            "api_url": API_URL or DEFAULT_ALIYUN_ASR_API_URL,
            "events": event_types,
            "message": "阿里云 ASR WebSocket 会话测试完成",
        }
    finally:
        with contextlib.suppress(Exception):
            await aliyun_ws.close()


async def aliyun_asr_stream(ws: WebSocket):
    """
    阿里云 Qwen-ASR-Realtime 适配。

    对外保持 coobee worker 协议：
      - 客户端继续发送 PCM Int16 LE 16kHz 二进制流
      - 服务端继续返回 {"partial": "..."} / {"final": "..."}
    对内转换为百炼 realtime 事件协议。
    """
    await ws.accept()

    if not API_KEY:
        await safe_send_json(ws, {"error": "未配置阿里云 DashScope API Key"})
        await ws.close(code=1008)
        return

    try:
        aliyun_ws = await connect_aliyun_ws(build_aliyun_realtime_url())
    except Exception as e:
        log.warning(f"连接阿里云实时 ASR 失败: {e}")
        await safe_send_json(ws, {"error": f"连接阿里云实时 ASR 失败: {e}"})
        await ws.close(code=1011)
        return

    last_partial = ""

    async def forward_audio():
        try:
            while True:
                message = await ws.receive()
                if message.get("type") == "websocket.disconnect":
                    break

                audio = message.get("bytes")
                if not audio:
                    continue

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

                text = extract_aliyun_text(event)
                if not text:
                    continue

                if event_type.endswith(".completed"):
                    last_partial = ""
                    if not await safe_send_json(ws, {"final": text}):
                        break
                elif text != last_partial:
                    last_partial = text
                    if not await safe_send_json(ws, {"partial": text}):
                        break
        except Exception as e:
            log.debug(f"阿里云实时 ASR 事件转发结束: {type(e).__name__}: {e}")

    try:
        await aliyun_ws.send(json.dumps(build_aliyun_session_update(), ensure_ascii=False))

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
    finally:
        with contextlib.suppress(Exception):
            await aliyun_ws.close()
        with contextlib.suppress(Exception):
            await ws.close()


# ==================== WebSocket 流式 ASR ====================

# 预计算常量
MAX_UTTERANCE_BYTES = int(MAX_UTTERANCE_SEC * BYTES_PER_SEC)
MIN_UTTERANCE_BYTES = int(MIN_UTTERANCE_SEC * BYTES_PER_SEC)
SILENCE_BYTES = int(SILENCE_DURATION_SEC * BYTES_PER_SEC)


@app.websocket("/ws/asr")
async def asr_stream(ws: WebSocket):
    if USE_ALIYUN_QWEN_ASR:
        await aliyun_asr_stream(ws)
    else:
        await local_asr_stream(ws)


async def local_asr_stream(ws: WebSocket):
    """
    流式 ASR — VAD 触发识别
    
    策略：检测说话停顿才触发识别，保证句子完整性。
    - 持续接收 PCM Int16 LE 音频，跟踪每个 chunk 的音量
    - 当检测到"有说话 → 静音超过阈值"时，将整段语音送去识别
    - 安全阀：连续说话超过 MAX_UTTERANCE_SEC 时强制切一次
    """
    await ws.accept()
    log.debug("WebSocket 客户端已连接")
    
    if not model_loaded:
        await ws.send_json({"status": "loading", "message": "模型加载中..."})
        while not model_loaded:
            await asyncio.sleep(0.5)
    await ws.send_json({"status": "ready", "message": "模型已就绪"})
    
    # ---- 会话状态 ----
    buffer = bytearray()
    recognized_pos = 0
    committed_text = ""
    connected = True
    pending = asyncio.Event()
    send_lock = asyncio.Lock()
    last_status_sent_at = 0.0
    
    # VAD 状态
    speech_start_pos = -1      # 当前语音段的起始位置（-1=没在说话）
    silence_start_pos = -1     # 静音开始的位置

    async def send_json(payload: dict) -> bool:
        try:
            async with send_lock:
                await ws.send_json(payload)
            return True
        except Exception:
            return False

    async def send_asr_status(asr_status: str, throttle_ms: int = 0, **payload) -> bool:
        """向前端推送 ASR 处理状态，文本结果仍走 partial/final。"""
        nonlocal last_status_sent_at

        now = time.time()
        if throttle_ms > 0 and (now - last_status_sent_at) * 1000 < throttle_ms:
            return True

        last_status_sent_at = now
        message = {
            "asr_status": asr_status,
            **payload,
        }
        return await send_json(message)
    
    async def receive_chunks():
        """接收 PCM 字节流，做 VAD 检测，在停顿时触发识别"""
        nonlocal connected, speech_start_pos, silence_start_pos, recognized_pos
        
        try:
            while True:
                data = await ws.receive_bytes()
                buf_pos_before = len(buffer)
                buffer.extend(data)
                
                energy = check_chunk_energy(data)
                is_speech = energy > SILENCE_THRESHOLD
                
                if is_speech:
                    # 正在说话
                    if speech_start_pos < 0:
                        speech_start_pos = buf_pos_before
                        # 跳过前面的静音，把 recognized_pos 推进到语音起始前 0.2s
                        margin = int(0.2 * BYTES_PER_SEC)
                        skip_to = max(recognized_pos, buf_pos_before - margin)
                        if skip_to > recognized_pos:
                            recognized_pos = skip_to
                        log.debug(f"[VAD] 开始说话 pos={speech_start_pos}")
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
                    
                    # 安全阀：连续说话太久，强制触发识别
                    speech_len = len(buffer) - speech_start_pos
                    if speech_len >= MAX_UTTERANCE_BYTES:
                        log.debug(
                            f"[VAD] 连续说话 {speech_len / BYTES_PER_SEC:.1f}s，"
                            f"强制触发"
                        )
                        pending.set()
                else:
                    # 静音
                    if silence_start_pos < 0:
                        silence_start_pos = buf_pos_before
                    
                    # 如果之前在说话，检查静音是否够长
                    if speech_start_pos >= 0:
                        silence_len = len(buffer) - silence_start_pos
                        if silence_len >= SILENCE_BYTES:
                            utterance_bytes = silence_start_pos - recognized_pos
                            utterance_ms = int(utterance_bytes / BYTES_PER_SEC * 1000)
                            log.debug(
                                f"[VAD] 停顿 "
                                f"(语音 {utterance_bytes / BYTES_PER_SEC:.1f}s)"
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
            log.debug(f"连接断开: {type(e).__name__}")
            connected = False
            pending.set()
    
    async def recognize_loop():
        """等待 VAD 触发，识别完整语段"""
        nonlocal committed_text, recognized_pos, speech_start_pos
        
        while connected:
            await pending.wait()
            pending.clear()
            
            if not connected:
                break
            
            # 确定识别范围
            available = len(buffer) - recognized_pos
            if available < MIN_UTTERANCE_BYTES:
                continue
            
            # 取音频段（含少量尾部静音没关系，模型能处理）
            end = min(recognized_pos + MAX_UTTERANCE_BYTES, len(buffer))
            segment = bytes(buffer[recognized_pos:end])
            segment_ms = int(len(segment) / BYTES_PER_SEC * 1000)
            
            try:
                if not await send_asr_status("recognizing", buffered_ms=segment_ms):
                    break

                result = await transcribe_async(segment)
                recognized_pos = end
                
                if speech_start_pos >= 0 and speech_start_pos < end:
                    speech_start_pos = end
                
                text = result["text"]
                if text:
                    committed_text = (
                        committed_text + text if committed_text else text
                    )
                    msg = {
                        "partial": committed_text,
                        "latency_ms": result["latency_ms"],
                    }
                    if result.get("lang"):
                        msg["lang"] = result["lang"]
                    if result.get("emotion"):
                        msg["emotion"] = result["emotion"]
                    if result.get("event"):
                        msg["event"] = result["event"]
                    if not await send_json(msg):
                        break
                    if not await send_asr_status(
                        "recognized",
                        text_tail=committed_text[-32:],
                        latency_ms=result["latency_ms"],
                    ):
                        break
            
            except Exception as e:
                log.warning(f"识别异常: {e}")
    
    # 并发运行
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
    
    # 最终识别：处理断开时尚未识别的尾部
    remaining = len(buffer) - recognized_pos
    if remaining > MIN_UTTERANCE_BYTES:
        segment = bytes(buffer[recognized_pos:])
        try:
            result = await transcribe_async(segment)
            if result["text"]:
                committed_text = (committed_text + result["text"]).strip()
        except Exception:
            pass
    
    if committed_text:
        await send_json({"final": committed_text})
    
    log.debug(
        f"会话结束: {len(buffer)} bytes, "
        f"已识别到 {recognized_pos} bytes"
    )


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
