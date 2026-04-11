<script setup lang="ts">
/**
 * App.vue — 根组件
 *
 * 应用的根组件，包含路由视图和全局 UI 容器。
 */

import { useRoute } from 'vue-router';
import Container from '@/components/Container.vue';
import ConfirmContainer from '@/components/Confirm/ConfirmContainer.vue';
import MessageContainer from '@/components/Message/MessageContainer.vue';
import StatusBar from '@/components/StatusBar.vue';

const route = useRoute();
</script>

<template>
  <div class="bg-background text-foreground transition-theme flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="flex min-h-0 flex-1 flex-col">
      <router-view />
      <Container />
    </div>
    <StatusBar v-if="!route.meta.fullscreen" />
  </div>

  <!-- 全局容器 -->
  <ConfirmContainer />
  <MessageContainer />
</template>

<style scoped>
.transition-theme {
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}
</style>
