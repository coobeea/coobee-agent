<script setup lang="ts">
/**
 * AboutView - 关于我们组件
 */
</script>

<template>
  <div class="h-full overflow-y-auto bg-background p-8 lg:p-12">
    <div class="mx-auto max-w-2xl">
      <!-- Logo & 标题 -->
      <div class="flex flex-col items-center border-b border-border pb-8">
        <div class="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <span class="i-carbon-bot text-5xl"></span>
        </div>
        <h2 class="text-2xl font-bold text-foreground">Coobee Agent</h2>
        <p class="mt-2 text-sm text-muted-foreground">智能 Agent 工作站</p>
        <p class="mt-3 rounded-md bg-muted px-3 py-1 text-xs font-mono text-foreground">v1.0.0</p>
      </div>

      <!-- 基本信息 -->
      <div class="mt-8 space-y-4">
        <div class="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <span class="text-sm font-medium text-foreground">应用版本</span>
          <span class="text-sm text-muted-foreground">1.0.0</span>
        </div>
        <div class="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <span class="text-sm font-medium text-foreground">Electron</span>
          <span class="text-sm text-muted-foreground">39.8.6</span>
        </div>
        <div class="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <span class="text-sm font-medium text-foreground">Node.js</span>
          <span class="text-sm text-muted-foreground">22.22.1</span>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="mt-8 flex gap-3">
        <button
          class="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted">
          <span class="i-carbon-upgrade h-4 w-4"></span>
          检查更新
        </button>
        <button
          class="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted">
          <span class="i-carbon-earth h-4 w-4"></span>
          官方网站
        </button>
      </div>

      <!-- 版权信息 -->
      <div class="mt-12 border-t border-border pt-6 text-center">
        <p class="text-xs text-muted-foreground">
          &copy; {{ new Date().getFullYear() }} Coobee Team. All rights reserved.
        </p>
      </div>
    </div>
  </div>
</template>
