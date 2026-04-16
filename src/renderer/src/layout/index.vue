<script setup lang="ts">
/**
 * Layout — 全局布局容器
 *
 * 结构：
 *   ┌──────────┬────────────────────────────┐
 *   │ Sidebar  │                            │
 *   │ (220px)  │       router-view          │
 *   │          │                            │
 *   │ 导航菜单  │  （各页面自行决定内部布局）  │
 *   │ 会话列表  │                            │
 *   └──────────┴────────────────────────────┘
 */

import Sidebar from './Sidebar.vue';
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<template>
  <div class="flex flex-1 min-h-0 w-full overflow-hidden bg-background text-foreground">
    <!-- 左侧导航 (fullscreen 模式下隐藏) -->
    <Sidebar v-if="!route.meta.fullscreen" />

    <!-- 主内容区域 -->
    <main class="flex flex-col min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
