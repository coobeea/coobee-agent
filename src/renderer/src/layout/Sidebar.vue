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
 *   │  最近任务             │  任务列表组件
 *   │  · 任务 A            │  (ThreadList.vue)
 *   │  · 任务 B            │
 *   │  ...                 │
 *   └──────────────────────┘
 */

import { ref, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAgentsStore } from '@/stores/agents';
import { useThreadsStore } from '@/stores/threads';
import ThreadList from '@/components/thread/ThreadList.vue';

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

const activeMenuId = ref('home');
const activeThreadId = ref<string | null>(null);

// 常用菜单（显示在侧边栏）
const mainMenuItems: MenuItem[] = [
  { id: 'home', label: '主页', icon: 'i-carbon-home', route: '/home' },
  { id: 'agents', label: '智能体', icon: 'i-carbon-bot', route: '/agents' },
  { id: 'settings', label: '系统设置', icon: 'i-carbon-settings', route: '/settings' }
];

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

const updateActiveState = (): void => {
  const path = route.path;
  if (path.startsWith('/thread/')) {
    // 任务详情页：高亮当前 thread
    activeMenuId.value = '';
    activeThreadId.value = path.split('/')[2];
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
  <aside class="flex flex-col w-60 shrink-0 bg-surface border-r border-border">
    <!-- 导航菜单 -->
    <nav class="flex flex-col gap-1 px-2.5 pt-4">
      <button
        v-for="item in mainMenuItems"
        :key="item.id"
        class="flex items-center gap-3 w-full h-10 px-2.5 rounded-lg text-sm font-medium cursor-pointer transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
        :class="
          item.id === activeMenuId
            ? 'bg-primary/12 text-primary'
            : 'bg-transparent text-muted-foreground hover:bg-foreground/6 hover:text-foreground'
        "
        @click="handleMenuClick(item)">
        <span :class="item.icon" class="inline-block w-[18px] h-[18px] shrink-0" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <!-- 最近任务（使用 ThreadList 组件） -->
    <ThreadList class="mt-3" :active-thread-id="activeThreadId" @thread-click="handleThreadClick" />
  </aside>
</template>
