/**
 * Health HTTP 路由
 *
 * 提供系统健康检查接口（示例）
 */

import type Router from '@koa/router';
import { log } from '@main/common/logger';

export function registerHealthRoutes(router: Router): void {
  // GET /gateway/system/health - 系统健康检查
  router.get('/system/health', async (ctx) => {
    ctx.body = {
      status: 'ok',
      timestamp: Date.now(),
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
  });

  // GET /gateway/system/info - 系统信息
  router.get('/system/info', async (ctx) => {
    ctx.body = {
      version: '1.0.0',
      platform: process.platform,
      arch: process.arch,
      node: process.version
    };
  });

  log.info('[HealthRoutes] HTTP 路由注册完成');
}
