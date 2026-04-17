<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAgentsStore } from '@/stores/agents';
import { useThreadsStore } from '@/stores/threads';
import { useGateway } from '@/composables/useGateway';

const router = useRouter();
const agentsStore = useAgentsStore();
const threadsStore = useThreadsStore();
const { request } = useGateway();

const loading = ref(false);

onMounted(() => {
  agentsStore.fetchAgents();
  threadsStore.fetchThreads();
});

// 获取推荐的智能体（前 4 个）
const recommendedAgents = computed(() => {
  return agentsStore.agents.slice(0, 4);
});

// 获取最近的任务（前 3 个）
const recentThreads = computed(() => {
  return threadsStore.threads.slice(0, 3);
});

// 问候语
const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了，注意休息';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  if (hour < 22) return '晚上好';
  return '夜深了，注意休息';
});

// 创建新任务
async function createNewTask(agentId: string = 'app-copilot') {
  if (loading.value) return;
  loading.value = true;
  try {
    const res = await request('chat.createThread', { 
      title: '新任务', 
      agentId 
    });
    if (res && (res as any).id) {
      threadsStore.fetchThreads(); // 刷新列表
      router.push(`/thread/${(res as any).id}`);
    }
  } catch (err) {
    console.error('Failed to create thread:', err);
  } finally {
    loading.value = false;
  }
}

// 继续任务
function continueTask(threadId: string) {
  router.push(`/thread/${threadId}`);
}

// 格式化时间
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000) return '刚刚';
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
    if (diff < 2592000_000) return `${Math.floor(diff / 86400_000)} 天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
</script>

<template>
  <div class="flex h-full flex-col bg-background text-foreground overflow-y-auto">
    <!-- 顶部欢迎区 -->
    <div class="px-10 py-12 pb-8 max-w-5xl mx-auto w-full">
      <h1 class="text-4xl font-bold tracking-tight mb-3">{{ greeting }}，今天想完成什么？</h1>
      <p class="text-lg text-muted-foreground">选择一个智能体开始新任务，或者继续之前的工作。</p>
    </div>

    <div class="px-10 pb-12 max-w-5xl mx-auto w-full flex flex-col gap-10">
      
      <!-- 快捷操作区 -->
      <section>
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-semibold flex items-center gap-2">
            <span class="i-carbon-flash text-primary"></span>
            快速开始
          </h2>
          <button @click="router.push('/agents')" class="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
            全部智能体 <span class="i-carbon-arrow-right"></span>
          </button>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <!-- 默认主助手卡片 -->
          <div 
            @click="createNewTask('app-copilot')"
            class="group relative flex flex-col p-5 rounded-xl border border-border bg-card hover:bg-accent/50 hover:border-primary/50 cursor-pointer transition-all shadow-sm hover:shadow-md"
          >
            <div class="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <span class="i-carbon-bot text-xl"></span>
            </div>
            <h3 class="font-medium text-base mb-1">通用助手</h3>
            <p class="text-sm text-muted-foreground line-clamp-2">全能型 AI 助手，可以帮你解答问题、编写代码、处理日常任务。</p>
          </div>

          <!-- 动态渲染其他推荐智能体 -->
          <div 
            v-for="agent in recommendedAgents.filter(a => a.id !== 'app-copilot').slice(0, 3)" 
            :key="agent.id"
            @click="createNewTask(agent.id)"
            class="group relative flex flex-col p-5 rounded-xl border border-border bg-card hover:bg-accent/50 hover:border-primary/50 cursor-pointer transition-all shadow-sm hover:shadow-md"
          >
            <div class="h-10 w-10 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <span class="i-carbon-machine-learning-model text-xl"></span>
            </div>
            <h3 class="font-medium text-base mb-1">{{ agent.name }}</h3>
            <p class="text-sm text-muted-foreground line-clamp-2">{{ agent.description || '暂无描述' }}</p>
          </div>
        </div>
      </section>

      <!-- 最近任务区 -->
      <section v-if="recentThreads.length > 0">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-semibold flex items-center gap-2">
            <span class="i-carbon-time text-primary"></span>
            继续工作
          </h2>
        </div>
        
        <div class="flex flex-col gap-3">
          <div 
            v-for="thread in recentThreads" 
            :key="thread.id"
            @click="continueTask(thread.id)"
            class="flex items-center justify-between p-4 rounded-xl border border-border bg-card hover:bg-accent/50 cursor-pointer transition-all shadow-sm group"
          >
            <div class="flex items-center gap-4">
              <div class="h-10 w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <span class="i-carbon-task text-muted-foreground"></span>
              </div>
              <div class="flex flex-col">
                <h3 class="font-medium text-base group-hover:text-primary transition-colors">{{ thread.title }}</h3>
                <div class="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                  <span class="flex items-center gap-1">
                    <span class="i-carbon-bot"></span>
                    {{ agentsStore.agents.find(a => a.id === thread.agentId)?.name || thread.agentId }}
                  </span>
                  <span class="flex items-center gap-1">
                    <span class="i-carbon-time"></span>
                    {{ formatTime(thread.updatedAt) }}
                  </span>
                  <span class="flex items-center gap-1" v-if="thread.messageCount">
                    <span class="i-carbon-chat"></span>
                    {{ thread.messageCount }} 条消息
                  </span>
                </div>
              </div>
            </div>
            <div class="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
              <span class="i-carbon-arrow-right text-xl"></span>
            </div>
          </div>
        </div>
      </section>

      <!-- 欢迎/空状态区 (仅当没有任务时显示) -->
      <section v-else class="flex flex-col items-center justify-center py-12 text-center border border-dashed border-border rounded-xl bg-muted/20">
        <div class="h-16 w-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
          <span class="i-carbon-rocket text-3xl"></span>
        </div>
        <h3 class="text-lg font-medium mb-2">一切准备就绪</h3>
        <p class="text-sm text-muted-foreground max-w-md mb-6">
          你的 Coobee Agent 已经配置完毕。点击上方的智能体卡片，开启你的第一个任务吧！
        </p>
      </section>

    </div>
  </div>
</template>
