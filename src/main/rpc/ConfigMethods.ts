/**
 * Config RPC 方法组
 *
 * 提供配置查询接口。
 */

import type { MethodGroup } from '@main/common/gateway/types';
import configManager from '@main/common/config';
import { createLogger } from '@main/common/logger';

const log = createLogger('config-methods');

export const configMethods: MethodGroup = {
  namespace: 'config',

  methods: {
    /**
     * 获取所有配置
     *
     * @returns 完整的配置对象
     */
    getAll: async () => {
      try {
        const config = configManager.getAll();
        log.debug('[config.getAll] 返回配置');
        return config;
      } catch (error) {
        log.error('[config.getAll] 获取配置失败:', error);
        throw error;
      }
    },

    /**
     * 获取特定配置项
     *
     * @param params.key - 配置键
     * @returns 配置值
     */
    get: async (params) => {
      try {
        const { key } = params;
        if (!key || typeof key !== 'string') {
          throw new Error('key is required');
        }

        const value = configManager.get(key as string);
        log.debug(`[config.get] 返回配置: ${key}`);
        return value;
      } catch (error) {
        log.error('[config.get] 获取配置失败:', error);
        throw error;
      }
    }
  }
};
