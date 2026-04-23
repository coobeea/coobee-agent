<script setup lang="ts">
/**
 * ThreadList — 任务列表组件
 *
 * 功能：
 * - 按时间分组显示任务（今天、昨天、本周、更早）
 * - 支持无限滚动加载
 * - 显示任务执行状态（波浪动画）
 * - 刷新功能
 */

import { computed } from 'vue';
import { useThreadsStore } from '@/stores/threads';

// ==================== Props & Emits ====================

interface Props {
  /** 当前激活的任务 ID */
  activeThreadId?: string | null;
}

withDefaults(defineProps<Props>(), {
  activeThreadId: null
});

const emit = defineEmits<{
  /** 点击任务时触发 */
  'thread-click': [threadId: string];
}>();

// ==================== Store ====================

const threadsStore = useThreadsStore();

// ==================== 时间分组 ====================

interface ThreadGroup {
  label: string;
  threads: typeof threadsStore.threads;
}

const groupedThreads = computed<ThreadGroup[]>(() => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisWeek = new Date(today);
  thisWeek.setDate(thisWeek.getDate() - 7);

  const groups: ThreadGroup[] = [
    { label: '今天', threads: [] },
    { label: '昨天', threads: [] },
    { label: '本周', threads: [] },
    { label: '更早', threads: [] }
  ];

  threadsStore.threads.forEach((thread) => {
    const threadDate = new Date(thread.updatedAt);
    if (threadDate >= today) {
      groups[0].threads.push(thread);
    } else if (threadDate >= yesterday) {
      groups[1].threads.push(thread);
    } else if (threadDate >= thisWeek) {
      groups[2].threads.push(thread);
    } else {
      groups[3].threads.push(thread);
    }
  });

  // 过滤掉空分组
  return groups.filter((g) => g.threads.length > 0);
});

// ==================== 工具函数 ====================

/** 检查任务是否正在执行 */
function isThreadStreaming(threadId: string): boolean {
  const thread = threadsStore.threads.find((t) => t.id === threadId);
  return thread?.runStatus === 'running' || thread?.runStatus === 'tool-pending';
}

/** 格式化相对时间 */
function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

// ==================== 事件处理 ====================

/** 刷新任务列表 */
function handleRefresh(): void {
  threadsStore.fetchThreads();
}

/** 点击任务 */
function handleThreadClick(threadId: string): void {
  emit('thread-click', threadId);
}

function handleScroll(event: Event): void {
  const target = event.target as HTMLElement;
  const scrollTop = target.scrollTop;
  const scrollHeight = target.scrollHeight;
  const clientHeight = target.clientHeight;

  // 滚动到距离底部 100px 以内时加载更多
  if (scrollHeight - scrollTop - clientHeight < 100) {
    if (!threadsStore.loading && threadsStore.hasMore) {
      threadsStore.loadMoreThreads();
    }
  }
}
</script>

<template>
  <div class="thread-list-container flex min-h-0 flex-1 flex-col border-t border-border/60">
    <!-- 标题栏 -->
    <div
      class="flex items-center justify-between px-3.5 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/75 select-none">
      <span>Recent</span>
      <button
        class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg bg-transparent text-muted-foreground transition hover:bg-background/80 hover:text-foreground active:scale-95"
        title="刷新"
        type="button"
        @click="handleRefresh">
        <span class="i-carbon-renew inline-block h-3 w-3" :class="{ 'animate-spin': threadsStore.loading }" />
      </button>
    </div>

    <!-- 任务列表（可滚动） -->
    <div class="session-list flex flex-1 flex-col overflow-y-auto px-2.5 pb-2 pt-0" @scroll="handleScroll">
      <!-- 按时间分组的任务列表 -->
      <template v-for="(group, groupIndex) in groupedThreads" :key="group.label">
        <!-- 分组标题 -->
        <div
          class="flex items-center justify-between px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/55 select-none"
          :class="groupIndex === 0 ? 'pb-1 pt-0' : 'pb-1 pt-2'">
          <span>{{ group.label }}</span>
          <span class="tabular-nums">{{ group.threads.length }}</span>
        </div>

        <!-- 分组内的任务 -->
        <button
          v-for="thread in group.threads"
          :key="thread.id"
          class="session-item relative mb-0.5 flex w-full cursor-pointer items-start rounded-xl border px-2.5 py-1.5 text-left text-sm transition"
          :class="
            activeThreadId === thread.id
              ? 'active border-primary/25 bg-primary/10 text-primary'
              : 'border-transparent bg-transparent text-foreground hover:border-border/70 hover:bg-background/65'
          "
          type="button"
          @click="handleThreadClick(thread.id)">
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-1">
              <span
                class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium leading-[18px] transition-colors"
                :class="{ 'font-semibold': activeThreadId === thread.id }">
                {{ thread.title }}
              </span>
              <div
                v-if="isThreadStreaming(thread.id)"
                class="streaming-wave ml-0.5 flex h-2.5 shrink-0 items-center gap-0.5"
                title="正在执行">
                <span class="wave-bar"></span>
                <span class="wave-bar"></span>
                <span class="wave-bar"></span>
              </div>
            </div>
            <span
              class="block text-[11px] leading-[15px] transition-colors"
              :class="activeThreadId === thread.id ? 'text-primary/75' : 'text-muted-foreground/70'">
              {{ formatRelativeTime(thread.updatedAt) }}
            </span>
          </div>
        </button>
      </template>

      <!-- 加载更多指示器 -->
      <div
        v-if="threadsStore.loading && threadsStore.threads.length > 0"
        class="flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-muted-foreground">
        <span class="i-carbon-renew inline-block h-3 w-3 animate-spin" />
        <span>加载中</span>
      </div>

      <!-- 空态 -->
      <div
        v-if="threadsStore.threads.length === 0 && !threadsStore.loading"
        class="mx-1 mt-1.5 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/70 bg-background/45 px-4 py-5 text-center text-[11px] leading-relaxed text-muted-foreground select-none">
        <span class="i-carbon-task-star inline-block h-5 w-5 text-primary/75" />
        <p>选择智能体并开启任务后<br />任务将出现在这里</p>
      </div>

      <!-- 首次加载中 -->
      <div
        v-if="threadsStore.loading && threadsStore.threads.length === 0"
        class="flex flex-col items-center gap-2 px-4 py-5 text-center text-[11px] leading-relaxed text-muted-foreground select-none">
        <span class="i-carbon-renew inline-block h-3.5 w-3.5 animate-spin" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ====== 任务项左侧指示条（伪元素） ====== */
.session-item::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 0;
  background: hsl(var(--primary));
  border-radius: 999px;
  transition: height 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.session-item.active::before {
  height: 16px;
}

/* ====== 滚动条样式 ====== */
.session-list::-webkit-scrollbar {
  width: 4px;
}

.session-list::-webkit-scrollbar-thumb {
  background: hsl(var(--foreground) / 0.1);
  border-radius: 4px;
}

.session-list::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--foreground) / 0.2);
}

/* ====== 正在执行的波浪动画 ====== */
.wave-bar {
  width: 2.5px;
  background-color: hsl(var(--primary));
  border-radius: 2px;
  animation: wave-bounce 1.2s infinite ease-in-out;
}

.session-item:not(.active) .wave-bar {
  background-color: hsl(var(--muted-foreground));
}

.wave-bar:nth-child(1) {
  height: 60%;
  animation-delay: -0.24s;
}

.wave-bar:nth-child(2) {
  height: 100%;
  animation-delay: -0.12s;
}

.wave-bar:nth-child(3) {
  height: 80%;
  animation-delay: 0s;
}

@keyframes wave-bounce {
  0%,
  100% {
    transform: scaleY(0.3);
  }
  50% {
    transform: scaleY(1);
  }
}
</style>
