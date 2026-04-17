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

/** Agent 分类类型 */
export type AgentType = 'agent' | 'orchestrator' | 'swarm' | 'quality-loop' | 'discussion';

/** Thread 索引条目（轻量版） */
export interface ThreadEntry {
  id: string;
  title: string;
  agentId: string;
  status: 'active' | 'archived' | 'deleted';
  runStatus: 'idle' | 'running' | 'tool-pending' | 'completed' | 'error';
  agentMode: string;
  agentType: AgentType;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  /** 工程目录（用户指定的输出目标路径） */
  projectDir?: string;
  /** 任务级别的模型覆盖（优先于 Agent 默认模型） */
  overrideModel?: string;
  /** Agent Home 路径 */
  agentHomePath?: string;
  /** Workspace 路径 */
  workspacePath?: string;
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

  /**
   * 更新 Thread 属性
   */
  async function updateThread(
    threadId: string,
    updates: {
      title?: string;
      messageCount?: number;
      status?: string;
      projectDir?: string | null;
      overrideModel?: string;
    }
  ): Promise<boolean> {
    try {
      const baseUrl = import.meta.env.VITE_GATEWAY_BASE_URL || 'http://127.0.0.1:8765/gateway';
      const url = `${baseUrl}/threads/${threadId}`;

      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });

      if (!res.ok) {
        throw new Error(`Failed to update thread: ${res.statusText}`);
      }

      // 更新本地状态
      const thread = threads.value.find((t) => t.id === threadId);
      if (thread) {
        Object.assign(thread, updates);
      }

      console.log(`[ThreadsStore] Thread ${threadId} 更新成功`);
      return true;
    } catch (err) {
      console.error('[ThreadsStore] 更新失败:', err);
      return false;
    }
  }

  return {
    threads,
    loading,
    error,
    activeThreadId,
    threadCount,
    fetchThreads,
    selectThread,
    clearSelection,
    updateThread
  };
});
