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
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { createLogger } from '@main/common/logger';
import { AgentStore } from '@main/agent/agents/AgentStore';
import { AgentImportExport } from '@main/agent/agents/AgentImportExport';
import type {
  AgentDefinition,
  AgentIndexEntry,
  CreateAgentParams,
  UpdateAgentParams
} from '@main/agent/agents/types';
import type { ApiResponse } from '@shared/api';

const log = createLogger('gateway-http-agents');

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
      const agents = await store.list();
      
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
      model: params?.model
    });

    if (!params?.id || !params?.name || !params?.description || !params?.instructions) {
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

    try {
      const store = AgentStore.getInstance();
      log.debug('[agents.create] Creating agent:', params.id);
      const agent = await store.create(params);

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
      ctx.status =
        msg.includes('already exists') || msg.includes('Invalid agent ID') ? 400 : 500;
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
      const store = AgentStore.getInstance();
      const agent = await store.update(agentId, body as UpdateAgentParams);
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

      const importExport = new AgentImportExport(
        store,
        store.getHomeManager(),
        app.getVersion()
      );

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

  router.post('/agents/import', async (ctx) => {
    const body = ctx.request.body as Record<string, unknown> | undefined;
    const zipData = body?.zipData as string | undefined; // Base64 编码的 ZIP 文件

    if (!zipData) {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: 'zipData is required (base64 encoded ZIP file)'
      };
      ctx.body = response;
      return;
    }

    let tempZipPath: string | null = null;

    try {
      // 将 Base64 数据解码为 Buffer 并保存到临时文件
      const buffer = Buffer.from(zipData, 'base64');
      tempZipPath = path.join(app.getPath('temp'), `agent-import-${Date.now()}.zip`);
      fs.writeFileSync(tempZipPath, buffer);

      const store = AgentStore.getInstance();
      const importExport = new AgentImportExport(
        store,
        store.getHomeManager(),
        app.getVersion()
      );

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
      // 清理临时 ZIP 文件
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
