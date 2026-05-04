"""
OCR Worker — 本地图像识别服务

FastAPI + WebSocket 服务，封装本地 GLM-OCR 模型。
由 RuntimeManager 管理生命周期。

启动方式（由 RuntimeManager 自动调用）：
    python server.py --port 18102

环境变量（由 RuntimeManager 注入）：
    MODEL_DIR          模型存储目录
    MODELSCOPE_CACHE   ModelScope 缓存目录
"""

import argparse
import asyncio
import base64
import io
import logging
import os
import sys
import time

from app.provider_registry import ProviderRegistry
from providers.aistudio_provider import AistudioOcrProvider
from providers.local_provider import LocalOcrProvider

# FastAPI / uvicorn 按需导入
try:
    from fastapi import FastAPI, WebSocket
    from fastapi.responses import JSONResponse
    import uvicorn
except ImportError:
    print("[OCR Worker] 缺少依赖，请先安装: pip install fastapi uvicorn", file=sys.stderr)
    sys.exit(1)

# ==================== 配置 ====================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_NAME = "GLM-OCR"
DEFAULT_AISTUDIO_OCR_API_URL = "https://z7q16fz7o7o6jcpb.aistudio-app.com/layout-parsing"

# 默认路径
DEFAULT_MODEL_DIR = os.path.join(os.environ.get("HOME", ""), ".cache", "modelscope", "hub")
MODEL_DIR = os.environ.get("MODEL_DIR", DEFAULT_MODEL_DIR)
API_KEY = (
    os.environ.get("OCR_API_KEY", "")
    or os.environ.get("AI_STUDIO_API_KEY", "")
    or os.environ.get("AISTUDIO_ACCESS_TOKEN", "")
)
API_URL = DEFAULT_AISTUDIO_OCR_API_URL


def get_configured_api_key(config: dict, model_name: str) -> str:
    raw_credentials = config.get("model_credentials")
    if isinstance(raw_credentials, dict):
        model_config = raw_credentials.get(model_name)
        if isinstance(model_config, dict):
            api_key = model_config.get("api_key")
            if isinstance(api_key, str) and api_key.strip():
                return api_key.strip()

    legacy_api_key = config.get("api_key")
    if isinstance(legacy_api_key, str) and legacy_api_key.strip():
        return legacy_api_key.strip()

    return ""

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
                print(f"[OCR Config] MODEL_DIR -> {MODEL_DIR}")

            if "model_name" in config and isinstance(config["model_name"], str) and config["model_name"].strip():
                MODEL_NAME = config["model_name"].strip()
                print(f"[OCR Config] MODEL_NAME -> {MODEL_NAME}")

            configured_api_key = get_configured_api_key(config, MODEL_NAME)
            if configured_api_key:
                API_KEY = configured_api_key
                print("[OCR Config] API_KEY loaded from runtime config")
    except Exception as e:
        print(f"[OCR Config] 读取本地配置失败: {e}", file=sys.stderr)

logging.basicConfig(level=logging.INFO, format="[OCR] %(message)s")
log = logging.getLogger("ocr")

app = FastAPI(title="OCR Worker", version="0.2.0")
_provider_registry = None

_model_lower = MODEL_NAME.lower()
USE_AISTUDIO_OCR = _model_lower.startswith("aistudio/") or _model_lower.startswith("online/")
AISTUDIO_OCR_MODEL = MODEL_NAME.split("/", 1)[1] if USE_AISTUDIO_OCR and "/" in MODEL_NAME else MODEL_NAME

# ==================== 全局状态 ====================

ocr_processor = None
ocr_model = None
model_loaded = False


# ==================== 模型加载 ====================

def detect_device() -> str:
    """自动选择最佳计算设备"""
    import torch
    if torch.cuda.is_available():
        return "cuda:0"
    elif torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_ocr_model():
    """加载 GLM-OCR 模型"""
    global ocr_processor, ocr_model, model_loaded
    
    import torch
    from transformers import AutoProcessor, AutoModelForImageTextToText
    
    device = detect_device()
    model_path = os.path.join(MODEL_DIR, MODEL_NAME)
    
    log.info(f"加载模型: {MODEL_NAME}")
    log.info(f"设备: {device}")
    log.info(f"模型路径: {model_path}")
    
    # 设置缓存目录
    os.environ.setdefault("MODELSCOPE_CACHE", MODEL_DIR)
    os.environ.setdefault("HF_HOME", MODEL_DIR)
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", os.path.join(MODEL_DIR, "hub"))
    
    t0 = time.time()
    
    # 加载处理器
    log.info("加载 Processor...")
    ocr_processor = AutoProcessor.from_pretrained(
        model_path,
        trust_remote_code=True
    )
    
    # 加载模型
    log.info("加载模型...")
    dtype = torch.bfloat16 if device == "cuda:0" else torch.float32
    ocr_model = AutoModelForImageTextToText.from_pretrained(
        model_path,
        torch_dtype=dtype,
        trust_remote_code=True
    )
    ocr_model.to(device)
    ocr_model.eval()
    
    elapsed = time.time() - t0
    model_loaded = True
    log.info(f"模型加载完成，耗时 {elapsed:.1f}s")


async def startup_local_provider() -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, load_ocr_model)


def build_provider_registry() -> ProviderRegistry:
    registry = ProviderRegistry()
    registry.register(
        LocalOcrProvider(
            model_name=MODEL_NAME,
            model_dir=MODEL_DIR,
            get_model_loaded=lambda: model_loaded,
            startup_cb=startup_local_provider,
            recognize_cb=recognize_local_image_async,
            create_test_image_cb=create_test_image,
        )
    )
    registry.register(
        AistudioOcrProvider(
            model_name=AISTUDIO_OCR_MODEL,
            model_dir=MODEL_DIR,
            api_key=API_KEY,
            api_url=API_URL,
            recognize_cb=recognize_aistudio_image_async,
            create_test_image_cb=create_test_image,
        )
    )
    return registry


def get_provider_registry() -> ProviderRegistry:
    global _provider_registry
    if _provider_registry is None:
        _provider_registry = build_provider_registry()
    return _provider_registry


def get_active_provider():
    if USE_AISTUDIO_OCR:
        return get_provider_registry().get("aistudio")
    return get_provider_registry().get("local")


# ==================== HTTP 接口 ====================

@app.get("/health")
async def health():
    """健康检查（RuntimeManager 轮询此接口判断是否就绪）"""
    return JSONResponse(await get_active_provider().health())


@app.post("/api/test")
async def test_ocr(request: dict = None):
    """实际测试 OCR Worker：生成一张测试图片并执行一次识别。"""
    started_at = time.time()
    provider = get_active_provider()

    try:
        result = await provider.run_test(request)
        return JSONResponse({
            "ok": True,
            **result,
            "latency_ms": int((time.time() - started_at) * 1000),
        })
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


@app.post("/api/ocr")
async def ocr_sync(request: dict):
    """
    同步 OCR 接口（整张图片识别后返回）
    
    请求体: { 
        "image": "base64_encoded_image_data",
        "task": "text|formula|table"  # 可选，默认 text
    }
    响应: { 
        "text": "识别的文本内容",
        "success": true|false,
        "error": "错误信息（如果有）"
    }
    """
    try:
        return JSONResponse(await get_active_provider().recognize(request))
    except Exception as e:
        log.error(f"OCR 处理异常: {e}")
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)


@app.websocket("/ws/ocr")
async def ocr_stream(ws: WebSocket):
    """
    流式 OCR 接口（长连接）
    
    客户端发送: { 
        "image": "base64_encoded_image_data",
        "task": "text|formula|table"  # 可选，默认 text
    }
    服务端返回: 
        { "status": "processing", "message": "正在识别..." }
        { "status": "success", "text": "识别结果", "latency_ms": 1234 }
        或 { "status": "error", "error": "错误信息" }
    """
    await get_active_provider().handle_ws(ws)


# ==================== OCR 处理 ====================

# 任务提示词映射
TASK_PROMPTS = {
    "text": "Text Recognition:",
    "formula": "Formula Recognition:",
    "table": "Table Recognition:"
}


def create_test_image(text: str) -> bytes:
    """生成一张小的 OCR 测试图片。"""
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (420, 120), "white")
    draw = ImageDraw.Draw(image)
    draw.text((32, 42), text, fill="black")

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def extract_aistudio_ocr_text(payload: dict) -> str:
    """兼容 AI Studio layout-parsing 的 OCR 响应格式。"""
    result = payload.get("result") if isinstance(payload, dict) else None
    if not isinstance(result, dict):
        return ""

    layout_results = result.get("layoutParsingResults")
    if not isinstance(layout_results, list) or not layout_results:
        return ""

    first = layout_results[0]
    if not isinstance(first, dict):
        return ""

    markdown = first.get("markdown")
    if isinstance(markdown, dict):
        text = markdown.get("text")
        if isinstance(text, str):
            return text

    text = first.get("text")
    return text if isinstance(text, str) else ""


def do_aistudio_ocr(image_bytes: bytes, task: str = "text") -> tuple[str, int]:
    """调用旧项目中的 AI Studio 在线 OCR 服务，返回 (Markdown 文本, 耗时ms)。"""
    if not API_KEY:
        raise RuntimeError("未配置 OCR API Token，请在设置中配置后再使用")

    import requests

    payload = {
        "file": base64.b64encode(image_bytes).decode("ascii"),
        "fileType": 1,
        "useDocOrientationClassify": False,
        "useDocUnwarping": False,
        "useChartRecognition": task == "table",
    }
    headers = {
        "Authorization": f"token {API_KEY}",
        "Content-Type": "application/json",
    }

    last_error = "在线 OCR 调用失败"
    for attempt in range(3):
        try:
            t0 = time.time()
            response = requests.post(API_URL, json=payload, headers=headers, timeout=120)
            latency_ms = int((time.time() - t0) * 1000)

            if response.status_code == 200:
                data = response.json()
                text = extract_aistudio_ocr_text(data)
                if text:
                    log.info(f"在线 OCR 完成: task={task} | 耗时={latency_ms}ms | 字符数={len(text)}")
                    return text, latency_ms
                raise RuntimeError("在线 OCR 返回空结果或响应格式不符合预期")

            if response.status_code == 401:
                raise RuntimeError("在线 OCR 认证失败，请检查 API Token")

            if response.status_code == 429 and attempt < 2:
                last_error = "在线 OCR 请求过于频繁，正在重试"
                time.sleep(5 * (attempt + 1))
                continue

            try:
                error_payload = response.json()
                last_error = error_payload.get("message") or error_payload.get("error") or response.text
            except Exception:
                last_error = response.text or f"HTTP {response.status_code}"
            raise RuntimeError(f"在线 OCR 返回错误: {last_error}")
        except requests.exceptions.Timeout:
            last_error = "在线 OCR 请求超时"
            if attempt < 2:
                time.sleep(3)
                continue
            raise RuntimeError(last_error)
        except requests.exceptions.ConnectionError:
            last_error = "在线 OCR 网络连接失败"
            if attempt < 2:
                time.sleep(3)
                continue
            raise RuntimeError(last_error)

    raise RuntimeError(last_error)


def do_local_recognize(image_bytes: bytes, task: str = "text") -> tuple[str, int]:
    """
    同步识别，返回 (文本, 推理耗时ms)
    
    Args:
        image_bytes: 图片字节流
        task: 任务类型 (text | formula | table)
    
    Returns:
        (识别文本, 推理耗时ms)
    """
    if not ocr_model or not ocr_processor:
        return "", 0
    
    import torch
    import tempfile
    
    prompt = TASK_PROMPTS.get(task, "Text Recognition:")
    
    tmp_file = None
    try:
        tmp_file = tempfile.NamedTemporaryFile(suffix='.jpg', delete=False)
        tmp_file.write(image_bytes)
        tmp_file.close()
        
        messages = [{
            "role": "user",
            "content": [
                {"type": "image", "url": tmp_file.name},
                {"type": "text", "text": prompt}
            ]
        }]
        
        t0 = time.time()
        
        inputs = ocr_processor.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_dict=True,
            return_tensors="pt"
        ).to(ocr_model.device)
    
        inputs.pop("token_type_ids", None)
        
        with torch.no_grad():
            generated_ids = ocr_model.generate(**inputs, max_new_tokens=8192)
        
        text = ocr_processor.decode(
            generated_ids[0][inputs["input_ids"].shape[1]:],
            skip_special_tokens=True
        )
        
        infer_ms = int((time.time() - t0) * 1000)
        
        log.info(f'识别完成: {task} 任务 | 耗时={infer_ms}ms | 字符数={len(text)}')
        
        return text, infer_ms
    finally:
        if tmp_file and os.path.exists(tmp_file.name):
            os.unlink(tmp_file.name)


async def recognize_image_async(image_bytes: bytes, task: str = "text") -> tuple[str, int]:
    """兼容旧调用的统一异步识别入口。"""
    if USE_AISTUDIO_OCR:
        return await recognize_aistudio_image_async(image_bytes, task)
    return await recognize_local_image_async(image_bytes, task)


async def recognize_local_image_async(image_bytes: bytes, task: str = "text") -> tuple[str, int]:
    """本地 OCR 异步版本：在线程池中执行识别"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, do_local_recognize, image_bytes, task)


async def recognize_aistudio_image_async(image_bytes: bytes, task: str = "text") -> tuple[str, int]:
    """AI Studio OCR 异步版本：在线程池中执行识别"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, do_aistudio_ocr, image_bytes, task)


@app.on_event("startup")
async def startup_event():
    """应用启动时加载当前 provider（在线程池中执行，不阻塞事件循环）"""
    await get_active_provider().startup()


# ==================== 启动 ====================

def main():
    parser = argparse.ArgumentParser(description="OCR Worker Server")
    parser.add_argument("--port", type=int, default=18102, help="服务端口")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="绑定地址")
    args = parser.parse_args()

    print(f"[OCR Worker] 启动服务 {args.host}:{args.port}")
    print(f"[OCR Worker] MODEL_DIR = {MODEL_DIR}")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
