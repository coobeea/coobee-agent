/**
 * 窗口状态管理 Store
 *
 * 极简版：只存储核心必要信息
 * - windowId: 当前窗口 ID
 * - currentTabId: 当前激活的 Tab ID
 *
 * 注意：事件监听由 eventbus/event_handles 处理
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { WindowInfoResponse } from '@shared/ipc';

export const useWindowStore = defineStore('window', () => {
  // ==================== State ====================
  const windowInfo = ref<WindowInfoResponse | null>(null);
  const windowId = ref<number | null>(null);
  const currentTabId = ref<number | null>(null);

  // ==================== Getters ====================
  const isReady = computed(() => windowId.value !== null);

  // ==================== Actions ====================

  /**
   * 初始化窗口信息
   */
  async function refreshWindowInfo(): Promise<void> {
    try {
      // 使用 preload 暴露的 API
      const info = await window.api?.getWindowInfo?.();
      if (info) {
        windowInfo.value = info;
        windowId.value = info.windowId;
        currentTabId.value = info.currentTabId || null;
      }
    } catch (error) {
      console.error('[WindowStore] Failed to initialize:', error);
    }
  }

  return {
    // State
    windowInfo,
    windowId,
    currentTabId,

    // Getters
    isReady,

    // Actions
    refreshWindowInfo
  };
});
