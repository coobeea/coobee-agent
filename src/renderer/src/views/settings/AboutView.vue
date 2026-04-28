<script setup lang="ts">
/**
 * AboutView - 关于我们组件
 */
</script>

<template>
  <div class="h-full overflow-y-auto bg-background text-foreground">
    <div class="mx-auto max-w-3xl px-6 py-6 lg:px-8">
      <header class="mb-6 flex items-center gap-3">
        <span class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <span class="i-carbon-bot inline-block h-5 w-5"></span>
        </span>
        <div class="min-w-0">
          <h2 class="text-xl font-semibold tracking-tight">Coobee Agent</h2>
          <p class="mt-1 text-sm text-muted-foreground">智能 Agent 工作站</p>
        </div>
      </header>

      <section class="rounded-lg border border-border bg-card">
        <div class="border-b border-border/60 px-5 py-4">
          <h3 class="text-sm font-semibold text-foreground">版本信息</h3>
        </div>

        <div class="divide-y divide-border/60">
          <div class="flex items-center justify-between gap-4 px-5 py-3">
            <span class="text-sm text-muted-foreground">应用版本</span>
            <span class="font-mono text-sm text-foreground">1.0.0</span>
          </div>
          <div class="flex items-center justify-between gap-4 px-5 py-3">
            <span class="text-sm text-muted-foreground">Electron</span>
            <span class="font-mono text-sm text-foreground">39.8.6</span>
          </div>
          <div class="flex items-center justify-between gap-4 px-5 py-3">
            <span class="text-sm text-muted-foreground">Node.js</span>
            <span class="font-mono text-sm text-foreground">22.22.1</span>
          </div>
        </div>
      </section>

      <p class="mt-6 text-xs text-muted-foreground">
        &copy; {{ new Date().getFullYear() }} Coobee Team. All rights reserved.
      </p>
    </div>
  </div>
</template>
