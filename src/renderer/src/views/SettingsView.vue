<script setup lang="ts">
/**
 * SettingsView — 设置页面容器
 *
 * 采用更克制的侧栏式布局，突出分组、层次和选中态。
 */

import { computed, ref, markRaw } from 'vue';
import ProviderSettings from './settings/ProviderSettings.vue';
import BasicSettings from './settings/BasicSettings.vue';
import AboutView from './settings/AboutView.vue';

type MenuItem = {
  id: string;
  label: string;
  description: string;
  icon: string;
  component: ReturnType<typeof markRaw>;
};

const menuItems: MenuItem[] = [
  {
    id: 'basic',
    label: '基本配置',
    description: '默认模型、启动与基础行为',
    icon: 'i-carbon-settings',
    component: markRaw(BasicSettings)
  },
  {
    id: 'providers',
    label: '模型控制',
    description: '供应商、连通性与模型选择',
    icon: 'i-carbon-machine-learning-model',
    component: markRaw(ProviderSettings)
  },
  {
    id: 'about',
    label: '关于我们',
    description: '版本信息与项目说明',
    icon: 'i-carbon-information',
    component: markRaw(AboutView)
  }
];

const activeMenu = ref(menuItems[0].id);
const activeComponent = computed(
  () => menuItems.find((item) => item.id === activeMenu.value)?.component ?? menuItems[0].component
);

function selectMenu(menuId: string): void {
  activeMenu.value = menuId;
}
</script>

<template>
  <div class="flex h-full bg-background text-foreground">
    <aside
      class="flex w-[280px] shrink-0 flex-col border-r border-border/60 bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/90">
      <div class="border-b border-border/40 px-6 pb-5 pt-6">
        <div class="flex items-center gap-3">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm ring-1 ring-primary/10">
            <span class="i-carbon-settings text-xl"></span>
          </div>
          <div class="min-w-0">
            <h1 class="truncate text-[15px] font-semibold tracking-tight text-foreground">系统设置</h1>
            <p class="mt-1 text-xs text-muted-foreground">统一管理当前应用配置</p>
          </div>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-4 py-5">
        <div class="mb-3 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
          常规
        </div>

        <div class="space-y-2">
          <button
            v-for="item in menuItems"
            :key="item.id"
            :class="[
              'group relative flex w-full items-start gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left transition-all duration-200',
              activeMenu === item.id
                ? 'border-border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
                : 'border-transparent bg-transparent hover:border-border/60 hover:bg-background/60 hover:shadow-sm'
            ]"
            @click="selectMenu(item.id)">
            <span
              :class="[
                'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ring-1',
                activeMenu === item.id
                  ? 'bg-primary text-primary-foreground ring-primary/10'
                  : 'bg-muted/70 text-muted-foreground ring-border/50 group-hover:bg-muted group-hover:text-foreground'
              ]">
              <span :class="[item.icon, 'inline-block h-4 w-4']"></span>
            </span>

            <span v-if="activeMenu === item.id" class="absolute inset-y-3 left-0 w-1 rounded-r-full bg-primary"></span>

            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold tracking-tight text-foreground">
                {{ item.label }}
              </span>
              <span class="mt-1 block text-xs leading-5 text-muted-foreground">
                {{ item.description }}
              </span>
            </span>
          </button>
        </div>
      </div>
    </aside>

    <section class="flex-1 overflow-hidden bg-background">
      <transition name="fade-slide" mode="out-in">
        <component :is="activeComponent" />
      </transition>
    </section>
  </div>
</template>

<style scoped>
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
