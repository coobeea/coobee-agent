<script setup lang="ts">
/**
 * AboutView - 关于我们组件
 */
// 暂时使用一个占位图标，因为可能没有 logo.svg
</script>

<template>
  <div class="h-full overflow-y-auto flex items-center justify-center p-8 lg:p-12 bg-background">
    <div class="rounded-3xl border border-border bg-card shadow-lg px-24 py-20 flex flex-col items-center max-w-4xl w-full">
      <!-- Logo 图标 -->
      <div class="relative mb-10">
        <div class="absolute inset-0 bg-primary/20 blur-3xl rounded-full transform scale-150"></div>
        <div class="relative h-32 w-32 flex items-center justify-center bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-3xl shadow-xl transform rotate-3 hover:rotate-0 transition-transform duration-500">
          <span class="i-carbon-bot text-7xl"></span>
        </div>
      </div>

      <!-- 应用名称 -->
      <h2 class="text-4xl font-extrabold text-foreground mb-3 tracking-tight">Coobee Agent</h2>
      <p class="text-base text-muted-foreground mb-2 font-medium">智能 Agent 工作站</p>
      <p class="text-xs text-primary font-mono bg-primary/10 px-4 py-1.5 rounded-full mt-3 border border-primary/20 shadow-sm">v1.0.0</p>

      <!-- 功能特点 -->
      <div class="mt-16 grid grid-cols-3 gap-12 w-full">
        <div class="flex flex-col items-center text-center group">
          <div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-600 group-hover:bg-blue-500 group-hover:text-white transition-colors duration-300 shadow-sm">
            <span class="i-carbon-chat-bot h-8 w-8"></span>
          </div>
          <p class="text-base font-semibold text-foreground">多模态交互</p>
          <p class="text-sm text-muted-foreground mt-2 leading-relaxed">语音、文字、图像<br/>全方位智能体验</p>
        </div>

        <div class="flex flex-col items-center text-center group">
          <div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-500/10 text-purple-600 group-hover:bg-purple-500 group-hover:text-white transition-colors duration-300 shadow-sm">
            <span class="i-carbon-network-3 h-8 w-8"></span>
          </div>
          <p class="text-base font-semibold text-foreground">可扩展架构</p>
          <p class="text-sm text-muted-foreground mt-2 leading-relaxed">Worker / Extension<br/>灵活定制能力</p>
        </div>

        <div class="flex flex-col items-center text-center group">
          <div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-green-500/10 text-green-600 group-hover:bg-green-500 group-hover:text-white transition-colors duration-300 shadow-sm">
            <span class="i-carbon-security h-8 w-8"></span>
          </div>
          <p class="text-base font-semibold text-foreground">本地优先</p>
          <p class="text-sm text-muted-foreground mt-2 leading-relaxed">数据隐私保护<br/>安全可靠运行</p>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="mt-16 flex gap-5">
        <button
          class="flex items-center gap-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-3.5 text-sm font-semibold transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5">
          <span class="i-carbon-upgrade h-5 w-5"></span>
          检查更新
        </button>
        <button
          class="flex items-center gap-2.5 rounded-xl border border-border bg-background hover:bg-muted px-8 py-3.5 text-sm font-semibold transition-all shadow-sm hover:shadow-md transform hover:-translate-y-0.5">
          <span class="i-carbon-earth h-5 w-5"></span>
          官方网站
        </button>
      </div>

      <!-- 版权信息 -->
      <div class="mt-20 pt-8 border-t border-border/50 w-full text-center">
        <p class="text-sm text-muted-foreground font-medium">
          &copy; {{ new Date().getFullYear() }} Coobee Team. All rights reserved.
        </p>
      </div>
    </div>
  </div>
</template>
