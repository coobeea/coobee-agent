/**
 * Thread（任务会话）Store
 *
 * 管理前端的 Thread 列表状态，通过统一的 API 模块获取数据。
 *
 * Thread = 一次任务会话，使用 Snowflake ID（有序），
 * 按 ID 降序排列 = 最新在前。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { getThreads, updateThread as updateThreadApi, type ThreadEntry } from '@/api/threads';
import type { ThreadMessageEventPayload } from '@shared/events/thread';

// Re-export types for consumers
export type { ThreadEntry };

export const useThreadsStore = defineStore('threads', () => {
  const threads = ref<ThreadEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const activeThreadId = ref<string | null>(null);

  // 分页状态
  const hasMore = ref(true);
  const currentOffset = ref(0);
  const pageSize = 50;
  const total = ref(0);

  const threadCount = computed(() => threads.value.length);

  function sortThreads(): void {
    threads.value.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  function upsertThread(thread: ThreadEntry): void {
    const index = threads.value.findIndex((item) => item.id === thread.id);

    if (index >= 0) {
      threads.value[index] = {
        ...threads.value[index],
        ...thread
      };
    } else {
      threads.value.unshift(thread);
      total.value += 1;
    }

    sortThreads();
  }

  function removeThread(threadId: string): void {
    const before = threads.value.length;
    threads.value = threads.value.filter((thread) => thread.id !== threadId);

    if (threads.value.length < before) {
      total.value = Math.max(0, total.value - 1);
    }

    if (activeThreadId.value === threadId) {
      activeThreadId.value = null;
    }
  }

  /**
   * 从后端获取 Thread 列表（首次加载，重置数据）
   */
  async function fetchThreads(agentId?: string): Promise<void> {
    loading.value = true;
    error.value = null;
    currentOffset.value = 0;
    threads.value = [];

    try {
      const result = await getThreads({
        offset: 0,
        limit: pageSize,
        agentId
      });

      if (result.success && result.data) {
        threads.value = result.data.threads || [];

        if (result.data.pagination) {
          total.value = result.data.pagination.total;
          hasMore.value = threads.value.length < total.value;
          currentOffset.value = pageSize;
        }

        console.log(`[ThreadsStore] 已加载 ${threads.value.length} 个任务 (总数: ${total.value})`);
      } else {
        error.value = result.error || '加载任务列表失败';
        threads.value = [];
        hasMore.value = false;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载任务列表失败';
      console.error('[ThreadsStore] 加载失败:', err);
      threads.value = [];
      hasMore.value = false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 加载更多任务（追加到现有列表）
   */
  async function loadMoreThreads(agentId?: string): Promise<void> {
    if (loading.value || !hasMore.value) return;

    loading.value = true;
    error.value = null;

    try {
      const result = await getThreads({
        offset: currentOffset.value,
        limit: pageSize,
        agentId
      });

      if (result.success && result.data) {
        const newThreads = result.data.threads || [];

        // 追加到现有列表
        threads.value = [...threads.value, ...newThreads];

        if (result.data.pagination) {
          total.value = result.data.pagination.total;
          hasMore.value = threads.value.length < total.value;
          currentOffset.value += newThreads.length;
        }

        console.log(
          `[ThreadsStore] 加载更多: +${newThreads.length} 个任务 (当前: ${threads.value.length}/${total.value})`
        );
      } else {
        error.value = result.error || '加载更多任务失败';
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载更多任务失败';
      console.error('[ThreadsStore] 加载更多失败:', err);
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
      status?: string;
      overrideModel?: string | null;
      enableThinking?: boolean;
    }
  ): Promise<boolean> {
    try {
      const result = await updateThreadApi(threadId, updates);

      if (result.success) {
        if (result.data?.thread) {
          upsertThread(result.data.thread);
        } else {
          const thread = threads.value.find((t) => t.id === threadId);
          if (thread) {
            Object.assign(thread, updates);
          }
        }

        console.log(`[ThreadsStore] Thread ${threadId} 更新成功`);
        return true;
      } else {
        console.error('[ThreadsStore] 更新失败:', result.error);
        return false;
      }
    } catch (err) {
      console.error('[ThreadsStore] 更新失败:', err);
      return false;
    }
  }

  function applyThreadMessage(payload: ThreadMessageEventPayload): void {
    if (payload.action === 'deleted') {
      removeThread(payload.threadId);
      return;
    }

    if (payload.thread) {
      upsertThread(payload.thread);
    }
  }

  return {
    threads,
    loading,
    error,
    activeThreadId,
    threadCount,
    hasMore,
    total,
    fetchThreads,
    loadMoreThreads,
    selectThread,
    clearSelection,
    updateThread,
    applyThreadMessage
  };
});
