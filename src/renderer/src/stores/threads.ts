/**
 * Thread（任务会话）Store
 *
 * 管理前端的 Thread 列表状态，通过 HTTP REST API 获取数据。
 *
 * Thread = 一次任务会话，使用 Snowflake ID（有序），
 * 按 ID 降序排列 = 最新在前。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

/** Thread 索引条目（轻量版） */
export interface ThreadEntry {
  id: string;
  title: string;
  agentId: string;
  status: 'active' | 'archived' | 'deleted';
  runStatus: 'idle' | 'running' | 'tool-pending' | 'completed' | 'error';
  agentMode: string;
  agentType: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export const useThreadsStore = defineStore('threads', () => {
  const threads = ref<ThreadEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const activeThreadId = ref<string | null>(null);

  const threadCount = computed(() => threads.value.length);

  /**
   * 从后端获取 Thread 列表
   */
  async function fetchThreads(agentId?: string): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      const baseUrl = import.meta.env.VITE_GATEWAY_BASE_URL || 'http://127.0.0.1:8765/gateway';
      const url = agentId ? `${baseUrl}/threads?agentId=${agentId}` : `${baseUrl}/threads`;

      const res = await fetch(url);
      
      if (!res.ok) {
        throw new Error(`Failed to fetch threads: ${res.statusText}`);
      }

      const data = await res.json();
      threads.value = data.threads || [];
      
      console.log(`[ThreadsStore] 已加载 ${threads.value.length} 个任务`);
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载任务列表失败';
      console.error('[ThreadsStore] 加载失败:', err);
      threads.value = [];
    } finally {
      loading.value = false;
    }
  }

  /**
   * 选中某个 Thread
   */
  function selectThread(id: string): void {
    activeThreadId.value = id;
  }

  /**
   * 清空选中状态
   */
  function clearSelection(): void {
    activeThreadId.value = null;
  }

  return {
    threads,
    loading,
    error,
    activeThreadId,
    threadCount,
    fetchThreads,
    selectThread,
    clearSelection
  };
});
