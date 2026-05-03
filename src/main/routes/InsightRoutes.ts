import type Router from '@koa/router';
import { log } from '@main/common/logger';
import { insightOrchestrator } from '@main/insight';
import type {
  AnalyzeInsightSessionReqVO,
  AnalyzeInsightSessionRespVO,
  ApiResponse,
  AppendInsightTextReqVO,
  AppendInsightTextRespVO,
  AppendInsightTranscriptReqVO,
  AppendInsightTranscriptRespVO,
  CompleteInsightSessionRespVO,
  PauseInsightSessionRespVO,
  CreateInsightTemplateReqVO,
  CreateInsightTemplateRespVO,
  CreateInsightSessionReqVO,
  CreateInsightSessionRespVO,
  DeleteInsightTemplateRespVO,
  GetInsightTemplateRespVO,
  GetInsightSessionRespVO,
  ListActiveInsightSessionsRespVO,
  ListInsightSessionsRespVO,
  ListInsightSnapshotsRespVO,
  ListInsightTemplatesRespVO,
  UpdateInsightTemplateReqVO,
  UpdateInsightTemplateRespVO,
  ResumeInsightSessionRespVO
} from '@shared/api/insight-types';

export function registerInsightRoutes(router: Router): void {
  router.get('/insight/templates', async (ctx) => {
    try {
      const response: ApiResponse<ListInsightTemplatesRespVO> = {
        success: true,
        data: {
          templates: await insightOrchestrator.listTemplates()
        }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.post('/insight/templates', async (ctx) => {
    const body = (ctx.request.body ?? {}) as Partial<CreateInsightTemplateReqVO>;
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: 'name is required and must be a non-empty string'
      } satisfies ApiResponse;
      return;
    }
    if (!body.description || typeof body.description !== 'string' || !body.description.trim()) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: 'description is required and must be a non-empty string'
      } satisfies ApiResponse;
      return;
    }
    if (!Array.isArray(body.dimensions) || body.dimensions.length === 0) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: 'dimensions is required and must contain at least one item'
      } satisfies ApiResponse;
      return;
    }

    try {
      const template = await insightOrchestrator.createTemplate(normalizeTemplateInput(body));

      const response: ApiResponse<CreateInsightTemplateRespVO> = {
        success: true,
        data: { template }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.get('/insight/templates/:id', async (ctx) => {
    try {
      const template = await insightOrchestrator.getTemplate(ctx.params.id);
      const response: ApiResponse<GetInsightTemplateRespVO> = {
        success: true,
        data: { template }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = isNotFoundError(error) ? 404 : 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.put('/insight/templates/:id', async (ctx) => {
    const body = (ctx.request.body ?? {}) as Partial<UpdateInsightTemplateReqVO>;
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: 'name is required and must be a non-empty string'
      } satisfies ApiResponse;
      return;
    }
    if (!body.description || typeof body.description !== 'string' || !body.description.trim()) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: 'description is required and must be a non-empty string'
      } satisfies ApiResponse;
      return;
    }
    if (!Array.isArray(body.dimensions) || body.dimensions.length === 0) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: 'dimensions is required and must contain at least one item'
      } satisfies ApiResponse;
      return;
    }

    try {
      const template = await insightOrchestrator.updateTemplate(ctx.params.id, normalizeTemplateInput(body));
      const response: ApiResponse<UpdateInsightTemplateRespVO> = {
        success: true,
        data: { template }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = isNotFoundError(error) ? 404 : isTemplateReadonlyError(error) ? 400 : 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.delete('/insight/templates/:id', async (ctx) => {
    try {
      await insightOrchestrator.deleteTemplate(ctx.params.id);
      const response: ApiResponse<DeleteInsightTemplateRespVO> = {
        success: true,
        data: { templateId: ctx.params.id }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = isNotFoundError(error) ? 404 : isTemplateReadonlyError(error) ? 400 : 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.post('/insight/sessions', async (ctx) => {
    const body = (ctx.request.body ?? {}) as Partial<CreateInsightSessionReqVO>;
    if (!body.templateId || typeof body.templateId !== 'string') {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: 'templateId is required and must be a string'
      } satisfies ApiResponse;
      return;
    }

    try {
      const session = await insightOrchestrator.createSession({
        templateId: body.templateId,
        agentId: typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : undefined,
        initialText: typeof body.initialText === 'string' ? body.initialText : undefined,
        metadata: isRecord(body.metadata) ? body.metadata : undefined
      });

      const response: ApiResponse<CreateInsightSessionRespVO> = {
        success: true,
        data: { session }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = isNotFoundError(error) ? 404 : 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.get('/insight/sessions/active', async (ctx) => {
    try {
      const sessions = await insightOrchestrator.listActiveSessions();
      const response: ApiResponse<ListActiveInsightSessionsRespVO> = {
        success: true,
        data: { sessions }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.get('/insight/sessions', async (ctx) => {
    try {
      const sessions = await insightOrchestrator.listSessions();
      const response: ApiResponse<ListInsightSessionsRespVO> = {
        success: true,
        data: { sessions }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.get('/insight/sessions/:id', async (ctx) => {
    try {
      const session = await insightOrchestrator.getSession(ctx.params.id);
      const response: ApiResponse<GetInsightSessionRespVO> = {
        success: true,
        data: { session }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = isNotFoundError(error) ? 404 : 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.post('/insight/sessions/:id/text', async (ctx) => {
    const body = (ctx.request.body ?? {}) as Partial<AppendInsightTextReqVO>;
    if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: 'text is required and must be a non-empty string'
      } satisfies ApiResponse;
      return;
    }

    try {
      const session = await insightOrchestrator.appendText(ctx.params.id, body.text);
      const response: ApiResponse<AppendInsightTextRespVO> = {
        success: true,
        data: {
          session,
          appendedLength: body.text.trim().length
        }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = isNotFoundError(error) ? 404 : 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.post('/insight/sessions/:id/transcript', async (ctx) => {
    const body = (ctx.request.body ?? {}) as Partial<AppendInsightTranscriptReqVO>;
    if (!body.text || typeof body.text !== 'string') {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: 'text is required and must be a string'
      } satisfies ApiResponse;
      return;
    }

    try {
      const session = await insightOrchestrator.appendTranscript(ctx.params.id, body.text);
      const response: ApiResponse<AppendInsightTranscriptRespVO> = {
        success: true,
        data: {
          session,
          appendedLength: body.text.length
        }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = isNotFoundError(error) ? 404 : 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.post('/insight/sessions/:id/analyze', async (ctx) => {
    const body = (ctx.request.body ?? {}) as Partial<AnalyzeInsightSessionReqVO>;
    try {
      const result = await insightOrchestrator.analyzeSession(ctx.params.id, body.trigger ?? 'manual');
      const response: ApiResponse<AnalyzeInsightSessionRespVO> = {
        success: true,
        data: result
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = isNotFoundError(error) ? 404 : 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.put('/insight/sessions/:id/complete', async (ctx) => {
    try {
      const session = await insightOrchestrator.completeSession(ctx.params.id);
      const response: ApiResponse<CompleteInsightSessionRespVO> = {
        success: true,
        data: { session }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = isNotFoundError(error) ? 404 : 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.put('/insight/sessions/:id/pause', async (ctx) => {
    try {
      const session = await insightOrchestrator.pauseSession(ctx.params.id);
      const response: ApiResponse<PauseInsightSessionRespVO> = {
        success: true,
        data: { session }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = isNotFoundError(error) ? 404 : 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.put('/insight/sessions/:id/resume', async (ctx) => {
    try {
      const session = await insightOrchestrator.resumeSession(ctx.params.id);
      const response: ApiResponse<ResumeInsightSessionRespVO> = {
        success: true,
        data: { session }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = isNotFoundError(error) ? 404 : 500;
      ctx.body = toErrorResponse(error);
    }
  });

  router.get('/insight/sessions/:id/snapshots', async (ctx) => {
    try {
      const snapshots = await insightOrchestrator.listSnapshots(ctx.params.id);
      const response: ApiResponse<ListInsightSnapshotsRespVO> = {
        success: true,
        data: { snapshots }
      };
      ctx.body = response;
    } catch (error) {
      ctx.status = isNotFoundError(error) ? 404 : 500;
      ctx.body = toErrorResponse(error);
    }
  });

  log.info('[InsightRoutes] HTTP 路由注册完成');
}

function toErrorResponse(error: unknown): ApiResponse {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error)
  };
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && /not found/i.test(error.message);
}

function isTemplateReadonlyError(error: unknown): boolean {
  return error instanceof Error && /不支持(编辑|删除)/.test(error.message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isTemplateDimension(value: unknown): value is {
  label: string;
  prompt: string;
  type?: string;
  options?: string[];
  maxItems?: number;
  showTrend?: boolean;
  required?: boolean;
} {
  return isRecord(value) && typeof value.label === 'string' && typeof value.prompt === 'string';
}

function isRefreshStrategy(value: unknown): value is {
  trigger: string;
  intervalSeconds?: number;
  minNewChars?: number;
  silenceMs?: number;
  charThreshold?: number;
  smartThreshold?: number;
  debounceMs?: number;
} {
  return isRecord(value) && typeof value.trigger === 'string';
}

function normalizeTemplateInput(body: Partial<CreateInsightTemplateReqVO | UpdateInsightTemplateReqVO>) {
  return {
    name: body.name ?? '',
    description: body.description ?? '',
    icon: typeof body.icon === 'string' ? body.icon : undefined,
    analysisPrompt: typeof body.analysisPrompt === 'string' ? body.analysisPrompt : undefined,
    refreshStrategy: isRefreshStrategy(body.refreshStrategy) ? body.refreshStrategy : undefined,
    dimensions: (body.dimensions ?? []).filter(isTemplateDimension).map((dimension) => ({
      label: dimension.label,
      prompt: dimension.prompt,
      type: dimension.type,
      options: Array.isArray(dimension.options) ? dimension.options.filter(isString) : undefined,
      maxItems: typeof dimension.maxItems === 'number' ? dimension.maxItems : undefined,
      showTrend: typeof dimension.showTrend === 'boolean' ? dimension.showTrend : undefined,
      required: typeof dimension.required === 'boolean' ? dimension.required : undefined
    }))
  };
}
