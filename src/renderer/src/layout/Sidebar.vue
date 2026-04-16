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
 *   │  我的智能体           │  标题
 *   │  · 智能体 A          │  智能体快捷列表（可滚动）
 *   │  · 智能体 B          │
 *   │  ...                 │
 *   └──────────────────────┘
 */

import { ref, watch, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAgentsStore } from '@/stores/agents';

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  route: string;
}

const router = useRouter();
const route = useRoute();
const agentsStore = useAgentsStore();

const activeMenuId = ref('home');
const activeAgentId = ref<string | null>(null);

// 常用菜单（显示在侧边栏）
const mainMenuItems: MenuItem[] = [
  { id: 'home', label: '主页', icon: 'i-carbon-home', route: '/home' },
  { id: 'agents', label: '智能体管理', icon: 'i-carbon-bot', route: '/agents' },
  { id: 'settings', label: '系统设置', icon: 'i-carbon-settings', route: '/settings' }
];

// 我的智能体列表（最多显示5个）
const myAgents = computed(() => {
  return agentsStore.agents.slice(0, 5);
});

const handleMenuClick = (item: MenuItem): void => {
  activeAgentId.value = null;
  router.push(item.route);
};

const handleAgentClick = (agentId: string): void => {
  activeAgentId.value = agentId;
  router.push(`/agent-workspace/${agentId}`);
};

const viewAllAgents = (): void => {
  activeAgentId.value = null;
  router.push('/agents');
};

const updateActiveState = (): void => {
  const path = route.path;
  if (path.startsWith('/agent-workspace/')) {
    // 在智能体工作区时，提取 agentId
    const match = path.match(/^\/agent-workspace\/([^/]+)/);
    if (match) {
      activeAgentId.value = match[1];
      activeMenuId.value = '';
    }
  } else if (path.startsWith('/agents')) {
    activeMenuId.value = 'agents';
    activeAgentId.value = null;
  } else if (route.name) {
    activeMenuId.value = route.name as string;
    activeAgentId.value = null;
  }
};

watch(() => route.path, updateActiveState);
onMounted(() => {
  agentsStore.fetchAgents();
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

    <!-- 智能体列表 -->
    <div class="session-section">
      <div class="section-header">
        <span>我的智能体</span>
        <button
          class="refresh-btn"
          title="刷新"
          @click="agentsStore.fetchAgents()">
          <span class="i-carbon-renew inline-block h-3 w-3" :class="{ 'animate-spin': agentsStore.loading }" />
        </button>
      </div>

      <div class="session-list">
        <!-- 智能体列表 -->
        <div
          v-for="agent in myAgents"
          :key="agent.id"
          class="session-item"
          :class="{ active: activeAgentId === agent.id }"
          @click="handleAgentClick(agent.id)">
          <div class="session-info">
            <div class="session-title-row">
              <span class="session-title">{{ agent.name }}</span>
            </div>
            <span class="session-meta">
              {{ agent.description }}
            </span>
          </div>
        </div>

        <!-- 查看全部 -->
        <button v-if="agentsStore.agentCount > 5" class="view-all-btn" @click="viewAllAgents">
          <span class="i-carbon-grid inline-block h-3 w-3" />
          <span>查看全部 ({{ agentsStore.agentCount }})</span>
        </button>

        <!-- 空态 -->
        <div v-if="myAgents.length === 0 && !agentsStore.loading" class="empty-state">
          <span class="i-carbon-bot inline-block h-6 w-6 opacity-[0.08]" />
          <p>还没有智能体<br />点击上方创建</p>
        </div>

        <!-- 加载中 -->
        <div v-if="agentsStore.loading && myAgents.length === 0" class="empty-state">
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
  gap: 4px;
}

.session-item {
  display: flex;
  align-items: flex-start;
  padding: 10px 14px;
  border-radius: 10px;
  color: hsl(var(--foreground) / 0.75);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid hsl(var(--border));
}

.session-item:hover {
  background: hsl(var(--foreground) / 0.04);
  border-color: hsl(var(--border));
}

.session-item.active {
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
  border-color: hsl(var(--border));
  box-shadow: 0 1px 3px hsl(var(--primary) / 0.1);
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
  transition: all 0.15s ease;
  border: 1px solid transparent;
}

.view-all-btn:hover {
  background: hsl(var(--foreground) / 0.04);
  color: hsl(var(--foreground) / 0.8);
  border-color: hsl(var(--border) / 0.4);
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
  color: hsl(var(--muted-foreground) / 0.5);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.session-item.active .session-meta {
  color: hsl(var(--primary) / 0.5);
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
  background: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
  box-shadow: 0 2px 4px hsl(var(--shadow) / 0.05);
}

.nav-btn.active .icon-sm {
  color: hsl(var(--secondary-foreground));
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