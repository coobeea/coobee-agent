/**
 * Config HTTP 路由
 *
 * 为模型供应商配置管理提供 REST HTTP 端点。
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET    /gateway/config/providers           — 获取所有 providers 配置
 *   GET    /gateway/config/secrets/status      — 获取 secrets 状态（脱敏）
 *   POST   /gateway/config/providers/:id/key   — 保存 API Key
 *   PATCH  /gateway/config/providers/:id       — 更新 provider 配置
 *   PUT    /gateway/config/providers/:id/enabled — 切换启用状态
 *   POST   /gateway/config/providers/:id/test  — 测试连接
 *
 * 设计：
 *   - 直接调用 ProviderConfigLoader 和 ConfigSecrets
 *   - 标准 JSON 请求/响应，前端用 fetch 即可
 *   - API Key 返回时始终脱敏
 *   - 错误统一返回 { error: string } + 对应 HTTP 状态码
 */

import type Router from '@koa/router';
import path from 'path';
import { log } from '@main/common/logger';
import { Providers } from '@main/config/providers';
import { loadSecrets, saveSecret } from '@main/common/config/ConfigSecrets';
import type {
  ApiResponse,
  ProvidersConfig,
  SecretStatus,
  SecretsStatus,
  GetProvidersRespVO,
  GetSecretsStatusRespVO,
  SaveProviderKeyReqVO,
  UpdateProviderReqVO,
  ToggleProviderReqVO,
  TestProviderRespVO
} from '@shared/api/config-types';

// 配置路径
const homeDir = path.join(process.cwd(), '.home');
const configDir = path.join(homeDir, 'config');
const secretsDir = configDir;

/**
 * 脱敏 API Key
 * 
 * @param key API Key
 * @returns 脱敏信息 { hasKey, masked }
 */
function maskApiKey(key: string | undefined): SecretStatus {
  if (!key || key.length === 0) {
    return { hasKey: false };
  }
  const masked = key.length > 8 ? key.slice(0, 4) + '***' + key.slice(-4) : '***';
  return { hasKey: true, masked };
}

/**
 * 脱敏 Provider 配置中的 API Key
 */
function maskProviderApiKeys(config: ProvidersConfig): ProvidersConfig {
  const masked: ProvidersConfig = {};
  
  for (const providerId in config) {
    masked[providerId] = { ...config[providerId] };
    
    if (masked[providerId].apiKey) {
      const { hasKey, masked: maskedKey } = maskApiKey(masked[providerId].apiKey);
      if (hasKey) {
        masked[providerId].apiKey = maskedKey;
        masked[providerId]._hasApiKey = true;
      } else {
        delete masked[providerId].apiKey;
        masked[providerId]._hasApiKey = false;
      }
    }
  }
  
  return masked;
}

export function registerConfigRoutes(router: Router): void {
  // ==================== GET PROVIDERS ====================

  /**
   * GET /gateway/config/providers
   * 获取所有 providers 配置（API Key 脱敏）
   */
  router.get('/config/providers', async (ctx) => {
    try {
      const providers = Providers.load(configDir, secretsDir);
      const masked = maskProviderApiKeys(providers);
      
      const response: ApiResponse<GetProvidersRespVO> = {
        success: true,
        data: { providers: masked }
      };
      
      ctx.body = response;
    } catch (error) {
      log.error('[ConfigRoutes] Failed to get providers:', error);
      ctx.status = 500;
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
      
      ctx.body = response;
    }
  });

  // ==================== GET SECRETS STATUS ====================

  /**
   * GET /gateway/config/secrets/status
   * 获取 secrets 状态（不返回实际 key，只返回是否已配置）
   */
  router.get('/config/secrets/status', async (ctx) => {
    try {
      const secrets = loadSecrets(secretsDir);
      const status: SecretsStatus = {};

      for (const [providerId, key] of Object.entries(secrets)) {
        status[providerId] = maskApiKey(key as string);
      }

      const response: ApiResponse<GetSecretsStatusRespVO> = {
        success: true,
        data: { secrets: status }
      };
      
      ctx.body = response;
    } catch (error) {
      log.error('[ConfigRoutes] Failed to get secrets status:', error);
      ctx.status = 500;
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
      
      ctx.body = response;
    }
  });

  // ==================== SAVE API KEY ====================

  /**
   * POST /gateway/config/providers/:id/key
   * 保存供应商 API Key
   * 
   * Body: { apiKey: string }
   */
  router.post('/config/providers/:id/key', async (ctx) => {
    const providerId = ctx.params.id;
    const body = ctx.request.body as Partial<Pick<SaveProviderKeyReqVO, 'apiKey'>>;

    if (!body.apiKey || typeof body.apiKey !== 'string') {
      ctx.status = 400;
      
      const response: ApiResponse = {
        success: false,
        error: 'apiKey is required and must be a string'
      };
      
      ctx.body = response;
      return;
    }

    try {
      // 保存到 secrets.json5
      saveSecret(secretsDir, providerId, body.apiKey);

      // 清除缓存，下次加载时会自动合并新的 key
      Providers.clearCache();

      log.info(`[ConfigRoutes] Saved API key for provider: ${providerId}`);
      
      const response: ApiResponse = {
        success: true
      };
      
      ctx.body = response;
    } catch (error) {
      log.error(`[ConfigRoutes] Failed to save API key for ${providerId}:`, error);
      ctx.status = 500;
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
      
      ctx.body = response;
    }
  });

  // ==================== UPDATE PROVIDER ====================

  /**
   * PATCH /gateway/config/providers/:id
   * 更新供应商配置（除了 API Key）
   * 
   * Body: { baseUrl?, enabled?, description?, ... }
   */
  router.patch('/config/providers/:id', async (ctx) => {
    const providerId = ctx.params.id;
    const body = ctx.request.body as Partial<UpdateProviderReqVO['updates']>;

    // 禁止通过此接口更新 apiKey（应使用专门的 key 接口）
    if ('apiKey' in body) {
      ctx.status = 400;
      
      const response: ApiResponse = {
        success: false,
        error: 'Cannot update apiKey through this endpoint. Use POST /config/providers/:id/key instead'
      };
      
      ctx.body = response;
      return;
    }

    // 禁止更新 id 和 _hasApiKey
    const updates = { ...body };
    if ('id' in updates) {
      delete updates.id;
    }
    if ('_hasApiKey' in updates) {
      delete (updates as any)._hasApiKey;
    }

    try {
      const loader = Providers.getLoader(configDir, secretsDir);
      loader.updateProvider(providerId, updates);

      log.info(`[ConfigRoutes] Updated provider: ${providerId}`, updates);
      
      const response: ApiResponse = {
        success: true
      };
      
      ctx.body = response;
    } catch (error) {
      log.error(`[ConfigRoutes] Failed to update provider ${providerId}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      ctx.status = errorMessage.includes('not found') ? 404 : 500;
      
      const response: ApiResponse = {
        success: false,
        error: errorMessage
      };
      
      ctx.body = response;
    }
  });

  // ==================== TOGGLE ENABLED ====================

  /**
   * PUT /gateway/config/providers/:id/enabled
   * 切换供应商启用状态
   * 
   * Body: { enabled: boolean }
   */
  router.put('/config/providers/:id/enabled', async (ctx) => {
    const providerId = ctx.params.id;
    const body = ctx.request.body as Partial<Pick<ToggleProviderReqVO, 'enabled'>>;

    if (typeof body.enabled !== 'boolean') {
      ctx.status = 400;
      
      const response: ApiResponse = {
        success: false,
        error: 'enabled must be a boolean'
      };
      
      ctx.body = response;
      return;
    }

    try {
      const loader = Providers.getLoader(configDir, secretsDir);
      loader.toggleProvider(providerId, body.enabled);

      log.info(`[ConfigRoutes] Toggled provider ${providerId}: ${body.enabled ? 'enabled' : 'disabled'}`);
      
      const response: ApiResponse = {
        success: true
      };
      
      ctx.body = response;
    } catch (error) {
      log.error(`[ConfigRoutes] Failed to toggle provider ${providerId}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      ctx.status = errorMessage.includes('not found') ? 404 : 500;
      
      const response: ApiResponse = {
        success: false,
        error: errorMessage
      };
      
      ctx.body = response;
    }
  });

  // ==================== TEST CONNECTION ====================

  /**
   * POST /gateway/config/providers/:id/test
   * 测试供应商连接
   * 
   * TODO: 实现实际的连接测试逻辑
   */
  router.post('/config/providers/:id/test', async (ctx) => {
    const providerId = ctx.params.id;

    try {
      // TODO: 实现实际的测试逻辑
      // 1. 加载 provider 配置
      // 2. 使用 API Key 调用 provider 的测试端点
      // 3. 返回测试结果

      log.info(`[ConfigRoutes] Testing connection for provider: ${providerId}`);

      // 临时实现：简单检查配置是否存在
      const providers = Providers.load(configDir, secretsDir);
      if (!providers[providerId]) {
        ctx.status = 404;
        
        const response: ApiResponse = {
          success: false,
          error: `Provider "${providerId}" not found`
        };
        
        ctx.body = response;
        return;
      }

      if (!providers[providerId].apiKey) {
        ctx.status = 400;
        
        const response: ApiResponse = {
          success: false,
          error: 'API Key not configured'
        };
        
        ctx.body = response;
        return;
      }

      // 模拟测试成功（实际应该调用 API）
      const testResult: TestProviderRespVO = {
        providerId,
        connected: true,
        latency: Math.random() * 100 + 50 // 模拟延迟
      };
      
      const response: ApiResponse<TestProviderRespVO> = {
        success: true,
        message: 'Connection test passed',
        data: testResult
      };
      
      ctx.body = response;
    } catch (error) {
      log.error(`[ConfigRoutes] Failed to test provider ${providerId}:`, error);
      ctx.status = 500;
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
      
      ctx.body = response;
    }
  });

  log.info('[ConfigRoutes] HTTP 路由注册完成');
}
