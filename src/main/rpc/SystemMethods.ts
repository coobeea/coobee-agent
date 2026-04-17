/**
 * System RPC 方法组
 *
 * 提供系统级别的 RPC 接口。
 *
 * 方法列表：
 *   system.ping      — ping/pong 测试
 *   system.echo      — 回显测试
 *   system.version   — 获取应用版本
 */

import type { MethodGroup } from '@main/common/gateway/types';
import { createLogger } from '@main/common/logger';
import { app } from 'electron';

const log = createLogger('system-methods');

export const systemMethods: MethodGroup = {
  namespace: 'system',

  methods: {
    /**
     * Ping/Pong 测试
     *
     * @returns { pong: true, timestamp: number }
     */
    ping: async () => {
      return {
        pong: true,
        timestamp: Date.now()
      };
    },

    /**
     * 回显测试
     *
     * @param params.message - 要回显的消息
     * @returns { echo: string }
     */
    echo: async (params) => {
      const { message } = params;
      log.debug(`Echo: ${message}`);
      return {
        echo: message,
        timestamp: Date.now()
      };
    },

    /**
     * 获取应用版本信息
     *
     * @returns { version: string, name: string, electron: string }
     */
    version: async () => {
      return {
        version: app.getVersion(),
        name: app.getName(),
        electron: process.versions.electron
      };
    }
  }
};
