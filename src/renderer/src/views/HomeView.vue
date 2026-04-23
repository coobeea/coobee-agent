<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAgentsStore } from '@/stores/agents';
import { useThreadsStore } from '@/stores/threads';
import { useGateway } from '@/composables/useGateway';

interface CreateThreadResponse {
  id?: string;
}

const router = useRouter();
const agentsStore = useAgentsStore();
const threadsStore = useThreadsStore();
const { request } = useGateway();

const loading = ref(false);

onMounted(() => {
  agentsStore.fetchAgents();
  threadsStore.fetchThreads();
});

const defaultAgent = computed(() => agentsStore.agents.find((agent) => agent.id === 'app-copilot'));
const featuredAgents = computed(() => agentsStore.agents.filter((agent) => agent.id !== 'app-copilot').slice(0, 3));
const recentThreads = computed(() => threadsStore.threads.slice(0, 4));
const agentCount = computed(() => agentsStore.agents.length);
const threadCount = computed(() => threadsStore.threads.length);
const runningThreadCount = computed(
  () =>
    threadsStore.threads.filter((thread) => thread.runStatus === 'running' || thread.runStatus === 'tool-pending')
      .length
);

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了，适合收尾';
  if (hour < 9) return '早上好，先抓重点';
  if (hour < 12) return '上午好，进入推进节奏';
  if (hour < 14) return '中午好，轻量处理一下';
  if (hour < 18) return '下午好，继续推进';
  if (hour < 22) return '晚上好，整理今天的线索';
  return '夜深了，适合收尾';
});

async function createNewTask(agentId: string = 'app-copilot'): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  try {
    const res = (await request('chat.createThread', {
      title: '新任务',
      agentId
    })) as CreateThreadResponse | null;

    if (res?.id) {
      threadsStore.fetchThreads();
      router.push(`/thread/${res.id}`);
    }
  } catch (err) {
    console.error('Failed to create thread:', err);
  } finally {
    loading.value = false;
  }
}

function continueTask(threadId: string): void {
  router.push(`/thread/${threadId}`);
}

function getAgentName(agentId: string): string {
  return agentsStore.agents.find((agent) => agent.id === agentId)?.name || agentId;
}

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
  <div class="home-view relative h-full overflow-y-auto bg-background text-foreground">
    <div
      class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,hsl(var(--primary)/0.16),transparent_30%),radial-gradient(circle_at_88%_18%,hsl(var(--foreground)/0.08),transparent_26%),linear-gradient(135deg,hsl(var(--background)),hsl(var(--surface-variant)))]" />

    <div class="relative mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-5 lg:px-8 lg:py-6">
      <section class="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_320px]">
        <article
          class="relative overflow-hidden rounded-3xl border border-border/70 bg-surface/85 p-5 backdrop-blur-xl lg:p-6">
          <div class="absolute right-6 top-6 h-20 w-20 rounded-full border border-primary/10 bg-primary/5 blur-2xl" />
          <div class="relative flex max-w-3xl flex-col gap-4">
            <div
              class="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              <span class="h-1.5 w-1.5 rounded-full bg-success" />
              Coobee Agent 工作台
            </div>

            <div class="space-y-3">
              <p class="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">{{ greeting }}</p>
              <h1
                class="home-display max-w-[680px] text-[clamp(1.9rem,3.6vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.05em]">
                把想法交给智能体，把进度留在今天。
              </h1>
              <p class="max-w-2xl text-sm leading-7 text-muted-foreground lg:text-base">
                选择一个 Agent 开始新任务，或者回到最近的工作现场。把目标说清楚，Coobee 会帮你组织工具、技能和上下文。
              </p>
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <button
                class="group inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="loading"
                type="button"
                @click="createNewTask('app-copilot')">
                <span class="i-carbon-add inline-block h-4 w-4 transition group-hover:rotate-90" />
                新建任务
              </button>
              <button
                class="inline-flex h-10 items-center gap-2 rounded-xl border border-border/80 bg-background/70 px-4 text-sm font-semibold text-foreground transition hover:border-primary/40 hover:bg-surface"
                type="button"
                @click="router.push('/agents')">
                浏览智能体
                <span class="i-carbon-arrow-right inline-block h-4 w-4" />
              </button>
            </div>
          </div>
        </article>

        <aside class="grid gap-2.5 rounded-3xl border border-border/70 bg-surface/75 p-3.5 backdrop-blur-xl">
          <div class="rounded-2xl border border-primary/10 bg-primary p-4 text-primary-foreground">
            <div class="mb-5 flex items-center justify-between">
              <span class="text-[11px] font-semibold uppercase tracking-[0.2em] opacity-75">今日状态</span>
              <span class="i-carbon-activity inline-block h-4 w-4 opacity-80" />
            </div>
            <div class="home-display text-3xl font-semibold tracking-[-0.05em]">{{ runningThreadCount }}</div>
            <p class="mt-1 text-xs opacity-75">正在运行的任务</p>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <div class="rounded-2xl border border-border/60 bg-background/70 p-3.5">
              <div class="text-xl font-semibold tracking-tight">{{ agentCount }}</div>
              <p class="mt-1 text-xs text-muted-foreground">可用智能体</p>
            </div>
            <div class="rounded-2xl border border-border/60 bg-background/70 p-3.5">
              <div class="text-xl font-semibold tracking-tight">{{ threadCount }}</div>
              <p class="mt-1 text-xs text-muted-foreground">历史任务</p>
            </div>
          </div>

          <div class="rounded-2xl border border-border/60 bg-background/70 p-3.5">
            <div class="mb-2.5 flex items-center justify-between text-xs font-semibold text-muted-foreground">
              <span>默认助手</span>
              <span class="i-carbon-bot inline-block h-4 w-4" />
            </div>
            <p class="line-clamp-2 text-sm font-medium leading-6">
              {{ defaultAgent?.description || '通用型应用管家，适合创建任务、整理线索、管理智能体和技能。' }}
            </p>
          </div>
        </aside>
      </section>

      <section>
        <div class="mb-3 flex items-end justify-between gap-4">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/75">Start with an agent</p>
            <h2 class="home-display mt-1 text-xl font-semibold tracking-[-0.035em]">快速开始</h2>
          </div>
          <button
            class="hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-surface hover:text-foreground sm:inline-flex"
            type="button"
            @click="router.push('/agents')">
            全部智能体
            <span class="i-carbon-arrow-right inline-block h-4 w-4" />
          </button>
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <button
            class="group relative min-h-[168px] overflow-hidden rounded-3xl border border-primary/20 bg-primary p-4 text-left text-primary-foreground transition hover:border-primary/30 md:col-span-2"
            type="button"
            @click="createNewTask('app-copilot')">
            <div class="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-primary-foreground/10" />
            <div class="relative flex h-full flex-col justify-between gap-5">
              <div class="flex items-center justify-between">
                <div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-foreground/12">
                  <span class="i-carbon-bot inline-block h-5 w-5" />
                </div>
                <span class="rounded-full bg-primary-foreground/12 px-3 py-1 text-xs font-semibold">推荐</span>
              </div>
              <div>
                <h3 class="home-display text-2xl font-semibold tracking-[-0.045em]">通用助手</h3>
                <p class="mt-2 max-w-md text-sm leading-6 text-primary-foreground/75">
                  从这里开始最稳：提问、写代码、整理任务、创建技能或配置智能体。
                </p>
              </div>
              <div class="flex items-center gap-2 text-sm font-semibold">
                立即开始
                <span
                  class="i-carbon-arrow-up-right inline-block h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </div>
          </button>

          <button
            v-for="agent in featuredAgents"
            :key="agent.id"
            class="group min-h-[168px] rounded-3xl border border-border/70 bg-surface/85 p-4 text-left transition hover:border-primary/35"
            type="button"
            @click="createNewTask(agent.id)">
            <div class="mb-6 flex items-center justify-between">
              <div
                class="flex h-9 w-9 items-center justify-center rounded-xl bg-background text-primary ring-1 ring-border/70">
                <span class="i-carbon-machine-learning-model inline-block h-5 w-5" />
              </div>
              <span
                class="i-carbon-arrow-up-right inline-block h-4 w-4 text-muted-foreground transition group-hover:text-primary" />
            </div>
            <h3 class="text-sm font-semibold tracking-tight">{{ agent.name }}</h3>
            <p class="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{{
              agent.description || '暂无描述'
            }}</p>
          </button>
        </div>
      </section>

      <section class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div class="rounded-3xl border border-border/70 bg-surface/85 p-4">
          <div class="mb-3 flex items-center justify-between">
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/75">Recent threads</p>
              <h2 class="home-display mt-1 text-xl font-semibold tracking-[-0.035em]">继续工作</h2>
            </div>
            <span class="i-carbon-time inline-block h-5 w-5 text-muted-foreground" />
          </div>

          <div v-if="recentThreads.length > 0" class="grid gap-2">
            <button
              v-for="thread in recentThreads"
              :key="thread.id"
              class="group flex items-center justify-between gap-4 rounded-2xl border border-transparent bg-background/55 px-3.5 py-2.5 text-left transition hover:border-primary/20 hover:bg-background"
              type="button"
              @click="continueTask(thread.id)">
              <div class="flex min-w-0 items-center gap-3">
                <div
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface text-muted-foreground ring-1 ring-border/70">
                  <span class="i-carbon-task inline-block h-4 w-4" />
                </div>
                <div class="min-w-0">
                  <h3 class="truncate text-sm font-semibold group-hover:text-primary">{{ thread.title }}</h3>
                  <p class="mt-1 truncate text-xs text-muted-foreground"
                    >{{ getAgentName(thread.agentId) }} · {{ formatTime(thread.updatedAt) }}</p
                  >
                </div>
              </div>
              <span
                class="i-carbon-arrow-right inline-block h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
            </button>
          </div>

          <div
            v-else
            class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/45 py-8 text-center">
            <span class="i-carbon-rocket mb-3 inline-block h-7 w-7 text-primary" />
            <h3 class="text-sm font-semibold">还没有任务</h3>
            <p class="mt-1 max-w-xs text-xs leading-5 text-muted-foreground"
              >选择上方智能体开启第一条任务，最近进度会沉淀在这里。</p
            >
          </div>
        </div>

        <aside class="rounded-3xl border border-border/70 bg-surface/75 p-4">
          <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/75">Work guide</p>
          <h2 class="home-display mt-2 text-lg font-semibold tracking-[-0.035em]">开始前的小建议</h2>
          <p class="mt-3 text-sm leading-7 text-muted-foreground">
            如果任务需要长期保存资料，把“要保存什么、保存到哪里、后续怎么用”直接告诉
            Agent；如果只是临时探索，直接从新任务开始即可。
          </p>
        </aside>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home-view {
  font-family: 'Avenir Next', 'PingFang SC', 'Hiragino Sans GB', var(--font-family-system);
}

.home-display {
  font-family: 'SF Pro Display', 'Avenir Next', 'PingFang SC', var(--font-family-system);
}
</style>
