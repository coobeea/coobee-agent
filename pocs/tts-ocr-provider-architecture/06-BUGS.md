# TTS OCR Provider 架构拆分 - 问题记录

> 创建时间：2026-05-04

## 问题列表

### BUG-001: 待补充

- **发现时间**：2026-05-04
- **严重程度**：轻微
- **现象**：当前尚未记录到阻塞性问题，先建立问题台账。
- **原因**：本轮刚进入实施阶段。
- **解决方案**：后续在实施和验证过程中实时补充。
- **状态**：已忽略

### BUG-002: OCR 在线链路缺少 AI Studio Token，无法完成真实识别

- **发现时间**：2026-05-04
- **严重程度**：一般
- **现象**：`aistudio/layout-parsing` 模式下，`/health` 正常，但 `/api/test` 返回 `未配置 OCR API Token，请在设置中配置后再使用`
- **原因**：当前环境没有 `OCR_API_KEY`、`AI_STUDIO_API_KEY`、`AISTUDIO_ACCESS_TOKEN`，运行时配置中也没有对应 `model_credentials`
- **解决方案**：已从 `/Users/lifeng/git/git-claw/agent-content-assistant/ocr-batch-processor/scripts/process_single.py` 和 `process_images.py` 找到同一份 Token，并写入当前 `ocr` 运行时配置；随后完成真实在线 OCR 验证
- **状态**：已解决
