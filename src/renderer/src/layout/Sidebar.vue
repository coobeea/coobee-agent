<script setup lang="ts">
/**
 * Sidebar — 左侧导航栏
 *
 * 布局：
 *   ┌──────────────────────┐
 *   │  🏠 主页              │  导航菜单
 *   │  🤖 智能体            │
 *   │  ⚙ 设置              │
 *   ├──────────────────────┤
 *   │  最近任务             │  标题
 *   │  · 任务 A            │  任务列表（可滚动）
 *   │  · 任务 B            │
 *   │  ...                 │
 *   └──────────────────────┘
 */

import { ref, watch, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAgentsStore } from '@/stores/agents';
import { useThreadsStore } from '@/stores/threads';
import { useChatStore } from '@/stores/chat';

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  route: string;
}

const router = useRouter();
const route = useRoute();
const agentsStore = useAgentsStore();
const threadsStore = useThreadsStore();
const chatStore = useChatStore();

const activeMenuId = ref('home');
const activeThreadId = ref<string | null>(null);

// 常用菜单（显示在侧边栏）
const mainMenuItems: MenuItem[] = [
  { id: 'home', label: '主页', icon: 'i-carbon-home', route: '/home' },
  { id: 'agents', label: '智能体', icon: 'i-carbon-bot', route: '/agents' },
  { id: 'settings', label: '系统设置', icon: 'i-carbon-settings', route: '/settings' }
];

// 最近任务列表（最多显示10个）
const recentThreads = computed(() => {
  return threadsStore.threads.slice(0, 10);
});

// 检查任务是否正在执行
function isThreadStreaming(threadId: string): boolean {
  return chatStore.getState(threadId).isStreaming;
}

// 格式化相对时间
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

const handleMenuClick = (item: MenuItem): void => {
  activeThreadId.value = null;
  router.push(item.route);
};

const handleThreadClick = (threadId: string): void => {
  activeThreadId.value = threadId;
  threadsStore.selectThread(threadId);
  
  // 跳转到任务视图
  router.push(`/thread/${threadId}`);
};

const refreshThreads = (): void => {
  threadsStore.fetchThreads();
};

const updateActiveState = (): void => {
  const path = route.path;
  if (path.startsWith('/thread/')) {
    // 任务详情页：高亮当前 thread
    activeMenuId.value = '';
    activeThreadId.value = route.params.id as string;
  } else if (path.startsWith('/agents')) {
    activeMenuId.value = 'agents';
    activeThreadId.value = null;
  } else if (route.name) {
    activeMenuId.value = route.name as string;
    activeThreadId.value = null;
  }
};

watch(() => route.path, updateActiveState);
onMounted(() => {
  agentsStore.fetchAgents();
  threadsStore.fetchThreads();
  updateActiveState();
});
</script>

<template>
  <aside class="sidebar">
    <!-- 导航菜单 -->
    <nav class="nav-main">
      <button
        v-for="item in mainMenuItems"
        :key="item.id"
        class="nav-btn"
        :class="{ active: item.id === activeMenuId }"
        @click="handleMenuClick(item)">
        <span :class="item.icon" class="icon-sm" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <!-- 最近任务 -->
    <div class="session-section">
      <div class="section-header">
        <span>最近任务</span>
        <button
          class="refresh-btn"
          title="刷新"
          @click="refreshThreads">
          <span class="i-carbon-renew inline-block h-3 w-3" :class="{ 'animate-spin': threadsStore.loading }" />
        </button>
      </div>

      <div class="session-list">
        <!-- 任务列表 -->
        <div
          v-for="thread in recentThreads"
          :key="thread.id"
          class="session-item"
          :class="{ active: activeThreadId === thread.id }"
          @click="handleThreadClick(thread.id)">
          <div class="session-info">
            <div class="session-title-row">
              <span class="session-title">{{ thread.title }}</span>
              <div v-if="isThreadStreaming(thread.id)" class="streaming-wave" title="正在执行">
                <span class="wave-bar"></span>
                <span class="wave-bar"></span>
                <span class="wave-bar"></span>
              </div>
            </div>
            <span class="session-meta">
              {{ formatRelativeTime(thread.updatedAt) }}
            </span>
          </div>
        </div>

        <!-- 空态 -->
        <div v-if="recentThreads.length === 0 && !threadsStore.loading" class="empty-state">
          <span class="i-carbon-task-star inline-block h-6 w-6 opacity-[0.08]" />
          <p>选择智能体并开启任务后<br />任务将出现在这里</p>
        </div>

        <!-- 加载中 -->
        <div v-if="threadsStore.loading && recentThreads.length === 0" class="empty-state">
          <span class="i-carbon-renew inline-block h-4 w-4 animate-spin opacity-20" />
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: 240px;
  flex-shrink: 0;
  background: hsl(var(--surface));
  border-right: 1px solid hsl(var(--border));
}

/* ====== 顶部导航 ====== */

.nav-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 12px 0;
}

/* ====== 会话列表区 ====== */

.session-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  margin-top: 12px;
  border-top: 1px solid hsl(var(--border) / 0.5);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 6px;
  font-size: 11px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  letter-spacing: 0.04em;
  text-transform: uppercase;
  user-select: none;
}

.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: hsl(var(--muted-foreground) / 0.6);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  background: transparent;
}

.refresh-btn:hover {
  background: hsl(var(--foreground) / 0.08);
  color: hsl(var(--foreground));
  transform: scale(1.05);
}

.refresh-btn:active {
  transform: scale(0.95);
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 8px;
  color: hsl(var(--foreground) / 0.8);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  background: transparent;
}

.session-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 0;
  background: hsl(var(--primary));
  border-radius: 0 2px 2px 0;
  transition: height 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.session-item:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground));
}

.session-item.active {
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
}

.session-item.active::before {
  height: 20px;
}

/* view all button */

.view-all-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  margin-top: 4px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground) / 0.6);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  background: transparent;
}

.view-all-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.8);
}

.session-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.session-title-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.session-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
  font-size: 13px;
  font-weight: 500;
  flex: 1;
  min-width: 0;
  transition: color 0.2s ease;
}

.session-item.active .session-title {
  font-weight: 600;
}

.session-meta {
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.55);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  transition: color 0.2s ease;
}

.session-item.active .session-meta {
  color: hsl(var(--primary) / 0.65);
}

/* 空态 */

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 16px;
  color: hsl(var(--muted-foreground) / 0.6);
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
  user-select: none;
}

/* ====== 公共按钮 ====== */

.nav-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  color: hsl(var(--muted-foreground));
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  background: transparent;
}

.nav-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground));
}

.nav-btn.active {
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
}

.nav-btn.active .icon-sm {
  color: hsl(var(--primary));
}

/* ====== 图标 ====== */

.icon-sm {
  display: inline-block;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

/* ====== 滚动条 ====== */

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

.streaming-wave {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 12px;
  margin-left: 2px;
  flex-shrink: 0;
}

.wave-bar {
  width: 2.5px;
  background-color: hsl(var(--primary));
  border-radius: 2px;
  animation: wave-bounce 1.2s infinite ease-in-out;
}

/* 未选中状态下，波浪颜色变浅以融入背景 */
.session-item:not(.active) .wave-bar {
  background-color: hsl(var(--muted-foreground) / 0.5);
}

.wave-bar:nth-child(1) { height: 60%; animation-delay: -0.24s; }
.wave-bar:nth-child(2) { height: 100%; animation-delay: -0.12s; }
.wave-bar:nth-child(3) { height: 80%; animation-delay: 0s; }

@keyframes wave-bounce {
  0%, 100% { transform: scaleY(0.3); }
  50% { transform: scaleY(1); }
}
</style>