<script setup lang="ts">
/**
 * Sidebar — 左侧导航栏
 *
 * 布局：
 *   ┌──────────────────────┐
 *   │  🤖 智能体            │  导航菜单
 *   │  ⚙ 设置              │
 *   ├──────────────────────┤
 *   │  最近任务             │  标题
 *   │  · 任务 A            │  Thread 列表（持久化，可滚动）
 *   │  · 任务 B            │
 *   │  ...                 │
 *   └──────────────────────┘
 */

import { ref, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  route: string;
}

const router = useRouter();
const route = useRoute();

const activeMenuId = ref('home');

// 常用菜单（显示在侧边栏）
const mainMenuItems: MenuItem[] = [
  { id: 'home', label: '主页', icon: 'i-carbon-home', route: '/home' },
  { id: 'settings', label: '系统设置', icon: 'i-carbon-settings', route: '/settings' }
];

// 模拟的最近任务列表
const mockThreads = ref([
  { id: '1', title: '分析项目代码结构', runStatus: 'completed', updatedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString() },
  { id: '2', title: '编写 API 接口文档', runStatus: 'running', updatedAt: new Date().toISOString() },
  { id: '3', title: '修复登录页面的 Bug', runStatus: 'idle', updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() }
]);

const activeThreadId = ref<string | null>(null);

const handleMenuClick = (item: MenuItem): void => {
  activeThreadId.value = null;
  router.push(item.route);
};

const handleThreadClick = (threadId: string): void => {
  activeThreadId.value = threadId;
  // TODO: 实际项目中这里会跳转到对应的 thread 页面
  console.log('Navigate to thread:', threadId);
};

/** 格式化相对时间 */
function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000) return '刚刚';
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`;
    if (diff < 2592000_000) return `${Math.floor(diff / 86400_000)}天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** runStatus 状态配置：每种状态对应颜色 class 和标签 */
function getRunStatusConfig(status?: string): { class: string; label: string } {
  switch (status) {
    case 'running':
      return { class: 'status-running', label: '运行中' };
    case 'tool-pending':
      return { class: 'status-tool', label: '工具执行中' };
    case 'approval-pending':
      return { class: 'status-approval', label: '等待审批' };
    case 'error':
      return { class: 'status-error', label: '出错' };
    case 'completed':
      return { class: 'status-completed', label: '已完成' };
    default:
      return { class: 'status-idle', label: '空闲' };
  }
}

const updateActiveState = (): void => {
  const name = route.name as string;
  if (name) {
    activeMenuId.value = name;
  }
};

watch(() => route.name, updateActiveState);
onMounted(() => updateActiveState());
</script>

<template>
  <aside class="sidebar">
    <!-- 导航菜单 -->
    <nav class="nav-main">
      <button
        v-for="item in mainMenuItems"
        :key="item.id"
        class="nav-btn"
        :class="{ active: item.id === activeMenuId && !activeThreadId }"
        @click="handleMenuClick(item)">
        <span :class="item.icon" class="icon-sm" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <!-- 会话列表 -->
    <div class="session-section">
      <div class="section-header">
        <span>最近任务</span>
        <button
          class="refresh-btn"
          title="刷新">
          <span class="i-carbon-renew inline-block h-3 w-3" />
        </button>
      </div>

      <div class="session-list">
        <!-- Thread 列表 -->
        <div
          v-for="thread in mockThreads"
          :key="thread.id"
          class="session-item"
          :class="{ active: activeThreadId === thread.id }"
          @click="handleThreadClick(thread.id)">
          <span
            class="status-dot"
            :class="getRunStatusConfig(thread.runStatus).class"
            :title="getRunStatusConfig(thread.runStatus).label" />
          <div class="session-info">
            <div class="session-title-row">
              <span class="session-title">{{ thread.title }}</span>
            </div>
            <span class="session-meta">
              {{ formatRelativeTime(thread.updatedAt) }}
            </span>
          </div>
        </div>

        <!-- 空态 -->
        <div v-if="mockThreads.length === 0" class="empty-state">
          <span class="i-carbon-task inline-block h-6 w-6 opacity-[0.08]" />
          <p>选择智能体并开启任务后<br />任务将出现在这里</p>
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
  height: 100%;
  background: hsl(var(--card) / 0.5);
  border-right: 1px solid hsl(var(--border) / 0.8);
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
  transition: all 0.15s ease;
}

.refresh-btn:hover {
  background: hsl(var(--foreground) / 0.08);
  color: hsl(var(--foreground));
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  color: hsl(var(--foreground) / 0.75);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}

.session-item:hover {
  background: hsl(var(--foreground) / 0.04);
  border-color: hsl(var(--border) / 0.5);
}

.session-item.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  border-color: hsl(var(--primary) / 0.2);
  box-shadow: 0 1px 2px hsl(var(--shadow) / 0.05);
}

/* status dot */

.status-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
}

.status-dot.status-running {
  background: hsl(142 71% 45%);
  box-shadow: 0 0 0 2px hsl(142 71% 45% / 0.2);
  animation: pulse-dot 1.5s ease-in-out infinite;
}

.status-dot.status-tool {
  background: hsl(217 91% 60%);
  box-shadow: 0 0 0 2px hsl(217 91% 60% / 0.2);
}

.status-dot.status-approval {
  background: hsl(38 92% 50%);
  box-shadow: 0 0 0 2px hsl(38 92% 50% / 0.2);
  animation: pulse-dot 2s ease-in-out infinite;
}

.status-dot.status-error {
  background: hsl(0 84% 60%);
}

.status-dot.status-completed {
  background: hsl(var(--muted-foreground) / 0.3);
}

.status-dot.status-idle {
  background: hsl(var(--muted-foreground) / 0.2);
}

@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
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
}

.session-meta {
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.7);
  line-height: 1;
}

.session-item.active .session-meta {
  color: hsl(var(--primary) / 0.6);
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
  padding: 0 14px;
  border-radius: 10px;
  color: hsl(var(--muted-foreground));
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}

.nav-btn:hover {
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--foreground));
  border-color: hsl(var(--border) / 0.4);
}

.nav-btn.active {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  box-shadow: 0 2px 4px hsl(var(--primary) / 0.2);
}

.nav-btn.active .icon-sm {
  color: hsl(var(--primary-foreground));
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
</style>