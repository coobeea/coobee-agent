/**
 * Agents HTTP 路由
 *
 * 为智能体 CRUD 操作注册标准 REST HTTP 端点。
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET    /gateway/agents           — 列出所有智能体
 *   GET    /gateway/agents/:id       — 获取智能体详情
 *   POST   /gateway/agents           — 创建智能体
 *   PATCH  /gateway/agents/:id       — 更新智能体
 *   DELETE /gateway/agents/:id       — 删除智能体
 *   POST   /gateway/agents/import    — 导入智能体 ZIP
 *   GET    /gateway/agents/:id/export — 导出智能体为 ZIP
 */

import type Router from '@koa/router';
import type Koa from 'koa';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import multer from '@koa/multer';
import { createLogger } from '@main/common/logger';
import { AgentStore } from '@main/agent/agents/AgentStore';
import { AgentImportExport } from '@main/agent/agents/AgentImportExport';
import type { AgentDefinition, AgentIndexEntry, CreateAgentParams, UpdateAgentParams } from '@main/agent/agents/types';
import type { AgentRuntimeKind } from '@main/agent/runtime/types';
import type { ApiResponse } from '@shared/api';

const IMPORT_UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
const IMPORT_UPLOAD_MAX_MB = IMPORT_UPLOAD_MAX_BYTES / 1024 / 1024;

/**
 * 智能体导入包上传中间件
 * - 使用磁盘存储（multer 会直接落盘到临时目录，免去手动 base64 解码）
 * - 限制单文件 ≤ 200MB，避免被异常大文件拖垮
 * - 仅接受单个字段 `file`，与前端 FormData append('file', zip) 对齐
 */
const importUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, os.tmpdir());
    },
    filename: (_req, _file, cb) => {
      cb(null, `agent-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);
    }
  }),
  limits: { fileSize: IMPORT_UPLOAD_MAX_BYTES }
});
const importUploadSingle = importUpload.single('file');

const log = createLogger('gateway-http-agents');

const AGENT_RUNTIME_TYPES = new Set<AgentRuntimeKind>(['pi-mono', 'openai', 'claude']);

function isAgentRuntimeKind(value: unknown): value is AgentRuntimeKind {
  return typeof value === 'string' && AGENT_RUNTIME_TYPES.has(value as AgentRuntimeKind);
}

interface MulterLikeError extends Error {
  code?: string;
  field?: string;
}

function isMulterLikeError(err: unknown): err is MulterLikeError {
  if (!(err instanceof Error)) return false;
  const candidate = err as MulterLikeError;
  return candidate.name === 'MulterError' && typeof candidate.code === 'string';
}

export function createImportUploadErrorResponse(err: unknown): { status: number; response: ApiResponse } {
  if (isMulterLikeError(err)) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return {
          status: 413,
          response: {
            success: false,
            code: err.code,
            error: `智能体导入包不能超过 ${IMPORT_UPLOAD_MAX_MB}MB，请选择更小的 ZIP 文件`
          }
        };
      case 'LIMIT_UNEXPECTED_FILE':
        return {
          status: 400,
          response: {
            success: false,
            code: err.code,
            error: '请使用 multipart/form-data 字段 "file" 上传一个 ZIP 文件，且一次只能上传一个文件'
          }
        };
      case 'LIMIT_FILE_COUNT':
        return {
          status: 400,
          response: {
            success: false,
            code: err.code,
            error: '一次只能上传一个智能体 ZIP 文件'
          }
        };
      default:
        return {
          status: 400,
          response: {
            success: false,
            code: err.code,
            error: err.message || '上传数据不符合要求，请重新选择 ZIP 文件'
          }
        };
    }
  }

  return {
    status: 400,
    response: {
      success: false,
      code: 'INVALID_MULTIPART_UPLOAD',
      error: err instanceof Error ? err.message : '上传数据格式无效，请重新选择 ZIP 文件'
    }
  };
}

const handleImportUpload: Koa.Middleware = async (ctx, next) => {
  try {
    await importUploadSingle(ctx, next);
  } catch (err) {
    const { status, response } = createImportUploadErrorResponse(err);
    ctx.status = status;
    ctx.body = response;
    log.warn(`[agents.import] Upload rejected: ${response.code ?? 'UPLOAD_ERROR'} ${response.error}`, err);
  }
};

function collectAgentRunConfig(body: Record<string, unknown>): {
  updates?: Pick<CreateAgentParams, 'runtimeType' | 'enableThinking' | 'asrEnabled' | 'ttsEnabled'>;
  error?: string;
} {
  const updates: Pick<CreateAgentParams, 'runtimeType' | 'enableThinking' | 'asrEnabled' | 'ttsEnabled'> = {};

  if ('runtimeType' in body) {
    if (!isAgentRuntimeKind(body.runtimeType)) return { error: 'runtimeType is invalid' };
    updates.runtimeType = body.runtimeType;
  }
  if ('enableThinking' in body) {
    if (typeof body.enableThinking !== 'boolean') return { error: 'enableThinking must be a boolean' };
    updates.enableThinking = body.enableThinking;
  }
  if ('asrEnabled' in body) {
    if (typeof body.asrEnabled !== 'boolean') return { error: 'asrEnabled must be a boolean' };
    updates.asrEnabled = body.asrEnabled;
  }
  if ('ttsEnabled' in body) {
    if (typeof body.ttsEnabled !== 'boolean') return { error: 'ttsEnabled must be a boolean' };
    updates.ttsEnabled = body.ttsEnabled;
  }

  return { updates };
}

/** 列表响应 */
interface ListAgentsResponse {
  agents: AgentIndexEntry[];
}

/** 详情响应 */
interface GetAgentResponse {
  agent: AgentDefinition;
}

/** 创建响应 */
interface CreateAgentResponse {
  agent: AgentDefinition;
}

/** 更新响应 */
interface UpdateAgentResponse {
  agent: AgentDefinition;
}

/** 删除响应 */
interface DeleteAgentResponse {
  agentId: string;
  deleted: boolean;
}

export function registerAgentRoutes(router: Router): void {
  // ==================== LIST ====================

  router.get('/agents', async (ctx) => {
    try {
      const store = AgentStore.getInstance();
      const agents = await store.listAsync();

      // 系统内置 Agent 排在最前
      agents.sort((a, b) => {
        if (a.createdBy === 'system' && b.createdBy !== 'system') return -1;
        if (a.createdBy !== 'system' && b.createdBy === 'system') return 1;
        return 0;
      });

      const response: ApiResponse<ListAgentsResponse> = {
        success: true,
        data: { agents }
      };
      ctx.body = response;
    } catch (err) {
      log.error('[agents.list] Error:', err);
      ctx.status = 500;
      const response: ApiResponse = {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
      ctx.body = response;
    }
  });

  // ==================== GET ====================

  router.get('/agents/:id', async (ctx) => {
    const agentId = ctx.params.id;
    if (!agentId) {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: 'agentId is required'
      };
      ctx.body = response;
      return;
    }

    try {
      const store = AgentStore.getInstance();
      const agent = await store.get(agentId);
      if (!agent) {
        ctx.status = 404;
        const response: ApiResponse = {
          success: false,
          error: `Agent "${agentId}" not found`
        };
        ctx.body = response;
        return;
      }

      const response: ApiResponse<GetAgentResponse> = {
        success: true,
        data: { agent }
      };
      ctx.body = response;
    } catch (err) {
      log.error(`[agents.get] Error (${agentId}):`, err);
      ctx.status = 500;
      const response: ApiResponse = {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
      ctx.body = response;
    }
  });

  // ==================== CREATE ====================

  router.post('/agents', async (ctx) => {
    const body = ctx.request.body as Record<string, unknown> | undefined;
    const params = body as CreateAgentParams | undefined;

    log.debug('[agents.create] Received params:', {
      id: params?.id,
      name: params?.name,
      descriptionLength: params?.description?.length,
      instructionsLength: params?.instructions?.length,
      skills: params?.skills,
      model: params?.model,
      runtimeType: params?.runtimeType,
      enableThinking: params?.enableThinking,
      asrEnabled: params?.asrEnabled,
      ttsEnabled: params?.ttsEnabled
    });

    if (!body || !params?.id || !params?.name || !params?.description || !params?.instructions) {
      log.warn('[agents.create] Validation failed:', {
        hasId: !!params?.id,
        hasName: !!params?.name,
        hasDescription: !!params?.description,
        hasInstructions: !!params?.instructions
      });
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: 'id, name, description, instructions are required'
      };
      ctx.body = response;
      return;
    }

    const { updates: runConfig, error: runConfigError } = collectAgentRunConfig(body);
    if (runConfigError || !runConfig) {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: runConfigError || 'Invalid agent runtime config'
      };
      ctx.body = response;
      return;
    }

    try {
      const store = AgentStore.getInstance();
      log.debug('[agents.create] Creating agent:', params.id);
      const agent = await store.create({ ...params, ...runConfig });

      ctx.status = 201;
      const response: ApiResponse<CreateAgentResponse> = {
        success: true,
        data: { agent }
      };
      ctx.body = response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('[agents.create] Error:', err);
      // ID 重复或格式错误 → 400，其他 → 500
      ctx.status = msg.includes('already exists') || msg.includes('Invalid agent ID') ? 400 : 500;
      const response: ApiResponse = {
        success: false,
        error: msg
      };
      ctx.body = response;
    }
  });

  // ==================== UPDATE (PATCH) ====================

  router.patch('/agents/:id', async (ctx) => {
    const agentId = ctx.params.id;
    if (!agentId) {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: 'agentId is required'
      };
      ctx.body = response;
      return;
    }

    const body = ctx.request.body as Record<string, unknown> | undefined;
    if (!body || Object.keys(body).length === 0) {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: 'Request body is empty'
      };
      ctx.body = response;
      return;
    }

    try {
      const { updates: runConfig, error: runConfigError } = collectAgentRunConfig(body);
      if (runConfigError || !runConfig) {
        ctx.status = 400;
        const response: ApiResponse = {
          success: false,
          error: runConfigError || 'Invalid agent runtime config'
        };
        ctx.body = response;
        return;
      }

      const store = AgentStore.getInstance();
      const agent = await store.update(agentId, { ...(body as UpdateAgentParams), ...runConfig });
      if (!agent) {
        ctx.status = 404;
        const response: ApiResponse = {
          success: false,
          error: `Agent "${agentId}" not found`
        };
        ctx.body = response;
        return;
      }

      const response: ApiResponse<UpdateAgentResponse> = {
        success: true,
        data: { agent }
      };
      ctx.body = response;
    } catch (err) {
      log.error(`[agents.update] Error (${agentId}):`, err);
      ctx.status = 500;
      const response: ApiResponse = {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
      ctx.body = response;
    }
  });

  // ==================== DELETE ====================

  router.delete('/agents/:id', async (ctx) => {
    const agentId = ctx.params.id;
    if (!agentId) {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: 'agentId is required'
      };
      ctx.body = response;
      return;
    }

    try {
      const store = AgentStore.getInstance();
      const deleted = await store.delete(agentId);
      if (!deleted) {
        ctx.status = 404;
        const response: ApiResponse = {
          success: false,
          error: `Agent "${agentId}" not found`
        };
        ctx.body = response;
        return;
      }

      const response: ApiResponse<DeleteAgentResponse> = {
        success: true,
        data: { agentId, deleted: true }
      };
      ctx.body = response;
    } catch (err) {
      log.error(`[agents.delete] Error (${agentId}):`, err);
      ctx.status = 500;
      const response: ApiResponse = {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
      ctx.body = response;
    }
  });

  // ==================== GET Personality Files ====================

  router.get('/agents/:id/personality', async (ctx) => {
    const agentId = ctx.params.id;
    if (!agentId) {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: 'agentId is required'
      };
      ctx.body = response;
      return;
    }

    try {
      const store = AgentStore.getInstance();
      const files = await store.getPersonalityFiles(agentId);

      const response: ApiResponse<{ files: Record<string, string> }> = {
        success: true,
        data: { files }
      };
      ctx.body = response;
    } catch (err) {
      log.error(`[agents.personality.get] Error (${agentId}):`, err);
      ctx.status = 404;
      const response: ApiResponse = {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
      ctx.body = response;
    }
  });

  // ==================== PUT Personality File ====================

  router.put('/agents/:id/personality/:fileName', async (ctx) => {
    const agentId = ctx.params.id;
    const fileName = ctx.params.fileName;
    if (!agentId || !fileName) {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: 'agentId and fileName are required'
      };
      ctx.body = response;
      return;
    }

    const body = ctx.request.body as Record<string, unknown> | undefined;
    const content = body?.content as string | undefined;

    if (content === undefined) {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: 'content is required'
      };
      ctx.body = response;
      return;
    }

    try {
      const store = AgentStore.getInstance();
      await store.updatePersonalityFile(agentId, fileName, content);

      const response: ApiResponse<{ success: true }> = {
        success: true,
        data: { success: true }
      };
      ctx.body = response;
    } catch (err) {
      log.error(`[agents.personality.update] Error (${agentId}/${fileName}):`, err);
      ctx.status = 404;
      const response: ApiResponse = {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
      ctx.body = response;
    }
  });

  // ==================== EXPORT ====================

  router.get('/agents/:id/export', async (ctx) => {
    const agentId = ctx.params.id;
    if (!agentId) {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: 'agentId is required'
      };
      ctx.body = response;
      return;
    }

    try {
      const store = AgentStore.getInstance();
      const agent = await store.get(agentId);
      if (!agent) {
        ctx.status = 404;
        const response: ApiResponse = {
          success: false,
          error: `Agent "${agentId}" not found`
        };
        ctx.body = response;
        return;
      }

      const importExport = new AgentImportExport(store, store.getHomeManager(), app.getVersion());

      const zipPath = await importExport.exportAgent(agentId, {
        includeSkills: true
      });

      // 设置响应头，让浏览器下载文件
      const fileName = path.basename(zipPath);
      ctx.set('Content-Type', 'application/zip');
      ctx.set('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);

      // 读取文件并返回
      ctx.body = fs.createReadStream(zipPath);

      // 文件传输完成后删除临时文件
      ctx.res.on('finish', () => {
        try {
          if (fs.existsSync(zipPath)) {
            fs.unlinkSync(zipPath);
          }
        } catch (err) {
          log.warn(`[agents.export] Failed to cleanup temp file: ${zipPath}`, err);
        }
      });

      log.info(`[agents.export] Exporting agent: ${agentId}`);
    } catch (err) {
      log.error(`[agents.export] Error (${agentId}):`, err);
      ctx.status = 500;
      const response: ApiResponse = {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
      ctx.body = response;
    }
  });

  // ==================== IMPORT ====================
  //
  // 采用 multipart/form-data 直传二进制，字段名固定为 `file`。
  // multer 会把上传文件落盘到系统临时目录，ctx.request.file.path 为落盘后的临时 zip 路径。

  router.post('/agents/import', handleImportUpload, async (ctx) => {
    const uploaded = ctx.request.file;

    if (!uploaded || !uploaded.path) {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: 'file is required (multipart/form-data field name: "file")'
      };
      ctx.body = response;
      return;
    }

    const tempZipPath = uploaded.path;
    log.info(
      `[agents.import] Received upload: name=${uploaded.originalname ?? 'unknown'}, size=${uploaded.size ?? 0}, path=${tempZipPath}`
    );

    try {
      const store = AgentStore.getInstance();
      const importExport = new AgentImportExport(store, store.getHomeManager(), app.getVersion());

      const result = await importExport.importAgent(tempZipPath);

      if (result.success) {
        ctx.status = 201;
        const response: ApiResponse<typeof result> = {
          success: true,
          data: result
        };
        ctx.body = response;
        log.info(`[agents.import] Successfully imported agent: ${result.agentId}`);
      } else {
        ctx.status = 400;
        const response: ApiResponse = {
          success: false,
          error: result.error || 'Import failed'
        };
        ctx.body = response;
      }
    } catch (err) {
      log.error('[agents.import] Error:', err);
      ctx.status = 500;
      const response: ApiResponse = {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
      ctx.body = response;
    } finally {
      // 清理 multer 落盘的临时 ZIP 文件
      if (tempZipPath && fs.existsSync(tempZipPath)) {
        try {
          fs.unlinkSync(tempZipPath);
        } catch (err) {
          log.warn(`[agents.import] Failed to cleanup temp file: ${tempZipPath}`, err);
        }
      }
    }
  });

  log.info('[agents] HTTP routes registered');
}
