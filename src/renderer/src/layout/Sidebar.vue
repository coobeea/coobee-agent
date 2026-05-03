<script setup lang="ts">
/**
 * Sidebar — 左侧导航栏
 *
 * 首页改版后，侧边栏不再只是菜单列表，而是承担：
 * - 产品身份识别
 * - 一级导航
 * - 最近任务入口
 */

import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAgentsStore } from '@/stores/agents';
import { useThreadsStore } from '@/stores/threads';
import ThreadList from '@/components/thread/ThreadList.vue';

interface MenuItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  route: string;
}

const router = useRouter();
const route = useRoute();
const agentsStore = useAgentsStore();
const threadsStore = useThreadsStore();

const activeMenuId = ref('home');
const activeThreadId = ref<string | null>(null);

const mainMenuItems: MenuItem[] = [
  { id: 'home', label: '主页', description: '任务启动台', icon: 'i-carbon-home', route: '/home' },
  { id: 'agents', label: '智能体', description: '配置与能力', icon: 'i-carbon-bot', route: '/agents' },
  {
    id: 'insight',
    label: '实时洞察',
    description: '实时洞察分析',
    icon: 'i-carbon-chart-line-data',
    route: '/insight'
  },
  { id: 'settings', label: '系统设置', description: '模型与偏好', icon: 'i-carbon-settings', route: '/settings' }
];

function handleMenuClick(item: MenuItem): void {
  activeThreadId.value = null;
  router.push(item.route);
}

function handleThreadClick(threadId: string): void {
  activeThreadId.value = threadId;
  threadsStore.selectThread(threadId);
  router.push(`/thread/${threadId}`);
}

function updateActiveState(): void {
  const path = route.path;
  if (path.startsWith('/thread/')) {
    activeMenuId.value = '';
    activeThreadId.value = path.split('/')[2];
  } else if (path.startsWith('/agents')) {
    activeMenuId.value = 'agents';
    activeThreadId.value = null;
  } else if (path.startsWith('/insight')) {
    activeMenuId.value = 'insight';
    activeThreadId.value = null;
  } else if (path.startsWith('/settings')) {
    activeMenuId.value = 'settings';
    activeThreadId.value = null;
  } else {
    activeMenuId.value = 'home';
    activeThreadId.value = null;
  }
}

watch(() => route.path, updateActiveState);
onMounted(() => {
  agentsStore.fetchAgents();
  threadsStore.fetchThreads();
  updateActiveState();
});
</script>

<template>
  <aside
    class="sidebar-shell flex w-[260px] shrink-0 flex-col border-r border-border/70 bg-surface/95 backdrop-blur-xl">
    <header class="px-3 pb-2 pt-3">
      <div class="flex items-center gap-2.5 rounded-2xl border border-border/70 bg-background/60 p-2">
        <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <span class="i-carbon-cube inline-block h-5 w-5" />
        </div>
        <div class="min-w-0">
          <div class="sidebar-display truncate text-[15px] font-semibold tracking-[-0.03em]">Coobee Agent</div>
          <div class="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span class="h-1.5 w-1.5 rounded-full bg-success" />
            本地工作台
          </div>
        </div>
      </div>
    </header>

    <nav class="px-2.5 pb-2">
      <div class="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground/70">Navigate</div>
      <div class="grid gap-1">
        <button
          v-for="item in mainMenuItems"
          :key="item.id"
          class="group relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all duration-200"
          :aria-current="item.id === activeMenuId ? 'page' : undefined"
          :class="
            item.id === activeMenuId
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
          "
          type="button"
          @click="handleMenuClick(item)">
          <span
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition"
            :class="
              item.id === activeMenuId
                ? 'bg-primary-foreground/12'
                : 'bg-background text-foreground ring-1 ring-border/60 group-hover:ring-primary/20'
            ">
            <span :class="item.icon" class="inline-block h-[18px] w-[18px]" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold">{{ item.label }}</span>
            <span
              class="mt-0.5 block truncate text-[11px]"
              :class="item.id === activeMenuId ? 'text-primary-foreground/70' : 'text-muted-foreground/75'">
              {{ item.description }}
            </span>
          </span>
        </button>
      </div>
    </nav>

    <div class="mx-3 mb-2.5 rounded-2xl border border-border/70 bg-background/55 p-2">
      <div class="mb-2 flex items-center justify-between">
        <div>
          <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-primary/75">Quick action</p>
          <p class="mt-1 text-xs font-medium text-muted-foreground">创建或调整智能体</p>
        </div>
        <span class="i-carbon-arrow-up-right inline-block h-4 w-4 text-muted-foreground" />
      </div>
      <button
        class="flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-semibold text-primary-foreground transition hover:bg-primary-hover"
        type="button"
        @click="router.push('/agents/create')">
        <span class="i-carbon-add inline-block h-4 w-4" />
        新建智能体
      </button>
    </div>

    <ThreadList
      class="min-h-0 flex-1 border-border/60"
      :active-thread-id="activeThreadId"
      @thread-click="handleThreadClick" />
  </aside>
</template>

<style scoped>
.sidebar-shell {
  font-family: 'Avenir Next', 'PingFang SC', 'Hiragino Sans GB', var(--font-family-system);
}

.sidebar-display {
  font-family: 'SF Pro Display', 'Avenir Next', 'PingFang SC', var(--font-family-system);
}
</style>
