<script setup lang="ts">
/**
 * SettingsView — 设置页面（容器）
 *
 * 左右分栏布局：
 * - 左侧：一级导航菜单
 * - 右侧：动态加载子组件
 */

import { ref, shallowRef, markRaw } from 'vue';
import ProviderSettings from './settings/ProviderSettings.vue';
import BasicSettings from './settings/BasicSettings.vue';
import AboutView from './settings/AboutView.vue';

// 一级导航状态
const menuItems = [
  {
    id: 'basic',
    label: '基本配置',
    icon: 'i-carbon-settings',
    component: markRaw(BasicSettings)
  },
  {
    id: 'providers',
    label: '模型控制',
    icon: 'i-carbon-machine-learning-model',
    component: markRaw(ProviderSettings)
  },
  {
    id: 'about',
    label: '关于我们',
    icon: 'i-carbon-information',
    component: markRaw(AboutView)
  }
];

const activeMenu = ref(menuItems[0].id); // 默认显示第一个配置

// 获取当前激活的组件 (使用 shallowRef 避免深度响应式)
const activeComponent = shallowRef(menuItems[0].component);

function selectMenu(menuId: string): void {
  activeMenu.value = menuId;
  const menuItem = menuItems.find((item) => item.id === menuId);
  if (menuItem) {
    activeComponent.value = menuItem.component;
  }
}
</script>

<template>
  <div class="flex h-full bg-background text-foreground">
    <!-- 左侧：一级导航菜单 -->
    <div class="flex w-60 flex-col border-r border-border/60 bg-surface">
      <div class="px-6 py-5 border-b border-border/40 flex items-center gap-3">
        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <span class="i-carbon-settings text-lg"></span>
        </div>
        <h1 class="text-base font-bold tracking-tight">系统设置</h1>
      </div>

      <div class="flex-1 overflow-y-auto px-3 py-4">
        <div class="mb-2 px-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          常规
        </div>
        <div class="flex flex-col gap-1">
          <button
            v-for="item in menuItems"
            :key="item.id"
            :class="[
              'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all text-left w-full',
              activeMenu === item.id
                ? 'bg-secondary text-secondary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
            ]"
            @click="selectMenu(item.id)">
            <span 
              :class="[
                item.icon, 
                'inline-block h-4 w-4 transition-colors',
                activeMenu === item.id ? 'text-secondary-foreground' : 'text-muted-foreground/70 group-hover:text-foreground/80'
              ]"></span>
            {{ item.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- 右侧：动态内容区域 (真实展示内容的地方) -->
    <div class="flex-1 overflow-hidden bg-background relative">
      <transition name="fade-slide" mode="out-in">
        <component :is="activeComponent" />
      </transition>
    </div>
  </div>
</template>

<style scoped>
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
