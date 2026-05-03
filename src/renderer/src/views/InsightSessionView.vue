<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { AnalysisSnapshot, AnalysisTemplate, InsightSession } from '@shared/types/insight';
import DimensionRenderer from '@/components/insight/DimensionRenderer.vue';
import SnapshotTimeline from '@/components/insight/SnapshotTimeline.vue';
import { getInsightSession, getInsightSnapshots, getInsightTemplates } from '@/api/insight';

const route = useRoute();
const router = useRouter();

const sessionId = computed(() => String(route.params.id || ''));
const session = ref<InsightSession | null>(null);
const snapshots = ref<AnalysisSnapshot[]>([]);
const templates = ref<AnalysisTemplate[]>([]);
const activeSnapshotId = ref('');
const loading = ref(true);
const error = ref('');
const copySuccess = ref('');

const activeSnapshot = computed(() => snapshots.value.find((item) => item.id === activeSnapshotId.value) ?? null);
const template = computed<AnalysisTemplate | null>(() => {
  if (!session.value) return null;
  return templates.value.find((t) => t.id === session.value?.templateId) ?? null;
});

onMounted(async () => {
  try {
    const [templatesResp, sessionResp, snapshotsResp] = await Promise.all([
      getInsightTemplates(),
      getInsightSession(sessionId.value),
      getInsightSnapshots(sessionId.value)
    ]);

    if (!templatesResp.success || !templatesResp.data) {
      throw new Error(templatesResp.error || '加载模板失败');
    }
    if (!sessionResp.success || !sessionResp.data) {
      throw new Error(sessionResp.error || '加载会话失败');
    }
    if (!snapshotsResp.success || !snapshotsResp.data) {
      throw new Error(snapshotsResp.error || '加载快照失败');
    }

    templates.value = templatesResp.data.templates;
    session.value = sessionResp.data.session;
    snapshots.value = snapshotsResp.data.snapshots;
    activeSnapshotId.value = snapshots.value[snapshots.value.length - 1]?.id || '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载详情失败';
  } finally {
    loading.value = false;
  }
});

function copyTranscript(): void {
  const text = activeSnapshot.value?.fullTranscript || session.value?.transcript || '';
  copyToClipboard(text, 'transcript');
}

function copyResult(): void {
  if (!activeSnapshot.value?.result) return;
  const lines: string[] = [];
  if (activeSnapshot.value.result.summary) lines.push(`摘要：${activeSnapshot.value.result.summary}\n`);
  for (const [, dim] of Object.entries(activeSnapshot.value.result.dimensions)) {
    const val = Array.isArray(dim.value) ? (dim.value as string[]).join('、') : String(dim.value);
    lines.push(`${dim.label}：${val}`);
    if (dim.rawText) lines.push(`  → ${dim.rawText}`);
  }
  copyToClipboard(lines.join('\n'), 'result');
}

async function copyToClipboard(text: string, label: string): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copySuccess.value = label;
    setTimeout(() => {
      copySuccess.value = '';
    }, 2000);
  } catch {
    // ignore
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN');
}

function formatDuration(start: number, end?: number): string {
  const diff = (end ?? start) - start;
  const m = Math.floor(diff / 60000);
  return m < 60 ? `${m}分钟` : `${Math.floor(m / 60)}小时${m % 60}分`;
}

function getStatusInfo(session: InsightSession): { label: string; cls: string } {
  switch (session.status) {
    case 'completed':
      return { label: '已完成', cls: 'bg-success/12 text-success' };
    case 'paused':
      return { label: '已暂停', cls: 'bg-warning/12 text-warning' };
    case 'analyzing':
      return { label: '分析中', cls: 'bg-info/12 text-info' };
    default:
      return { label: '进行中', cls: 'bg-primary/12 text-primary' };
  }
}

function isIconClass(icon?: string): boolean {
  return Boolean(icon && icon.startsWith('i-carbon-'));
}
</script>

<template>
  <div
    class="flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.08),transparent_26%),radial-gradient(circle_at_top_right,hsl(var(--foreground)/0.04),transparent_22%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--surface-variant)))]">
    <!-- Header -->
    <header
      class="relative shrink-0 border-b border-border/70 bg-surface/90 shadow-[0_12px_32px_-24px_rgba(0,0,0,0.42)] backdrop-blur-xl">
      <div class="flex items-center gap-4 px-6 py-4">
        <button
          class="group flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-xs font-medium text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
          @click="router.push('/insight')">
          <span class="i-carbon-arrow-left inline-block h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          返回列表
        </button>

        <div class="h-5 w-px bg-border/70" />

        <div v-if="session" class="flex min-w-0 flex-1 items-center gap-3">
          <div
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-primary/10 shadow-[0_10px_24px_-18px_hsl(var(--primary)/0.28)]">
            <span
              v-if="isIconClass(template?.icon)"
              class="inline-block h-5 w-5 text-primary/80"
              :class="template?.icon" />
            <span v-else class="text-lg">{{ template?.icon || '📊' }}</span>
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2.5">
              <h1 class="truncate text-base font-bold text-foreground">{{ session.templateName }}</h1>
              <span
                class="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                :class="getStatusInfo(session).cls">
                {{ getStatusInfo(session).label }}
              </span>
            </div>
            <div class="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground/60">
              <span>{{ formatDate(session.startTime) }}</span>
              <span class="text-muted-foreground/30">·</span>
              <span>{{ formatDuration(session.startTime, session.endTime) }}</span>
              <span class="text-muted-foreground/30">·</span>
              <span>{{ session.snapshotCount }} 次分析</span>
              <template v-if="session.config?.agentName">
                <span class="text-muted-foreground/30">·</span>
                <span>智能体 {{ session.config.agentName }}</span>
              </template>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- Error Banner -->
    <div
      v-if="error"
      class="flex items-center gap-2 border-b border-destructive/20 bg-destructive/8 px-6 py-2.5 text-xs text-destructive shadow-[inset_0_-1px_0_rgba(0,0,0,0.02)]">
      <span class="i-carbon-warning-alt inline-block h-3.5 w-3.5 shrink-0" />
      {{ error }}
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 flex-col items-center justify-center gap-3">
      <div class="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
      <span class="text-sm text-muted-foreground/50">加载会话详情...</span>
    </div>

    <!-- Main Content -->
    <template v-if="!loading && session">
      <div class="flex min-h-0 flex-1 overflow-hidden bg-border/60">
        <!-- Left: Transcript Panel (2/5) -->
        <div class="flex w-[40%] min-w-0 flex-col border-r border-border/70 bg-background/92 backdrop-blur-sm">
          <div class="flex shrink-0 items-center justify-between border-b border-border/60 bg-surface/28 px-5 py-3">
            <div class="flex items-center gap-2.5">
              <div
                class="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-primary/10 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <span class="i-carbon-text-align-left inline-block h-3.5 w-3.5" />
              </div>
              <span class="text-xs font-bold tracking-wide text-foreground/70">转写文本</span>
              <span
                v-if="activeSnapshot"
                class="rounded-md border border-border/60 bg-accent/50 px-2 py-0.5 text-[10px] font-semibold text-accent-foreground/72">
                快照 #{{ activeSnapshot.sequence }}
              </span>
            </div>
            <button
              class="flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-[11px] font-medium transition-all"
              :class="
                copySuccess === 'transcript'
                  ? 'bg-success/10 text-success'
                  : 'text-muted-foreground/50 hover:bg-accent hover:text-foreground'
              "
              @click="copyTranscript">
              <span
                class="inline-block h-3 w-3"
                :class="copySuccess === 'transcript' ? 'i-carbon-checkmark' : 'i-carbon-copy'" />
              {{ copySuccess === 'transcript' ? '已复制' : '复制文本' }}
            </button>
          </div>
          <div class="flex-1 overflow-y-auto px-5 py-4">
            <div v-if="activeSnapshot || session.transcript" class="relative">
              <div class="absolute left-0 top-0 h-full w-0.5 rounded-full bg-primary/12" />
              <p class="whitespace-pre-wrap break-words pl-4 text-[13px] leading-[1.9] text-foreground/84">
                {{ activeSnapshot?.fullTranscript || session.transcript }}
              </p>
            </div>
            <div v-else class="flex flex-col items-center justify-center gap-2 py-16">
              <span class="i-carbon-document inline-block h-8 w-8 text-muted-foreground/15" />
              <span class="text-xs text-muted-foreground/30">无转写内容</span>
            </div>
          </div>
        </div>

        <!-- Right: Analysis Results Panel (3/5) -->
        <div class="flex min-w-0 flex-1 flex-col bg-card/72 backdrop-blur-sm">
          <div class="flex shrink-0 items-center justify-between border-b border-border/60 bg-surface/22 px-5 py-3">
            <div class="flex items-center gap-2.5">
              <div
                class="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-accent/10 text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <span class="i-carbon-chart-line-data inline-block h-3.5 w-3.5" />
              </div>
              <span class="text-xs font-bold tracking-wide text-foreground/70">分析结果</span>
            </div>
            <div class="flex items-center gap-2">
              <span
                v-if="activeSnapshot?.result.confidence"
                class="rounded-full border border-primary/10 bg-primary/10 px-3 py-0.5 text-[10px] font-bold text-primary">
                {{ Math.round(activeSnapshot.result.confidence * 100) }}% 置信度
              </span>
              <button
                v-if="activeSnapshot"
                class="flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-[11px] font-medium transition-all"
                :class="
                  copySuccess === 'result'
                    ? 'bg-success/10 text-success'
                    : 'text-muted-foreground/50 hover:bg-accent hover:text-foreground'
                "
                @click="copyResult">
                <span
                  class="inline-block h-3 w-3"
                  :class="copySuccess === 'result' ? 'i-carbon-checkmark' : 'i-carbon-copy'" />
                {{ copySuccess === 'result' ? '已复制' : '复制结果' }}
              </button>
            </div>
          </div>

          <div v-if="activeSnapshot" class="flex-1 overflow-y-auto px-5 py-4">
            <!-- Summary Card -->
            <div
              v-if="activeSnapshot.result.summary"
              class="mb-5 rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/7 via-primary/3 to-transparent px-5 py-4 shadow-[0_14px_34px_-24px_rgba(0,0,0,0.2)]">
              <div class="mb-2 flex items-center gap-2">
                <span class="i-carbon-text-creation inline-block h-4 w-4 text-primary/50" />
                <span class="text-[10px] font-bold uppercase tracking-[0.15em] text-primary/50">摘要</span>
              </div>
              <p class="text-sm leading-7 text-foreground/82">{{ activeSnapshot.result.summary }}</p>
            </div>

            <!-- Dimensions -->
            <div class="flex flex-col gap-3">
              <DimensionRenderer
                v-for="(dim, key) in activeSnapshot.result.dimensions"
                :key="String(key)"
                :dimension="dim"
                :icon="template?.dimensions.find((d) => d.key === String(key))?.icon"
                :change="activeSnapshot.changes?.find((c) => c.key === String(key))"
                :show-trend="template?.dimensions.find((d) => d.key === String(key))?.showTrend" />
            </div>

            <!-- Latency -->
            <div class="mt-4 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground/30">
              <span class="i-carbon-timer inline-block h-3 w-3" />
              分析耗时 {{ activeSnapshot.latencyMs }}ms
            </div>
          </div>

          <!-- Empty State -->
          <div
            v-else
            class="flex flex-1 flex-col items-center justify-center gap-3 bg-gradient-to-b from-transparent to-background/20">
            <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/5 text-accent/30">
              <span class="i-carbon-chart-line-data inline-block h-7 w-7" />
            </div>
            <p class="text-sm font-medium text-muted-foreground/40">选择快照查看分析结果</p>
            <p class="text-xs text-muted-foreground/25">点击下方时间线中的快照卡片</p>
          </div>
        </div>
      </div>

      <!-- Snapshot Timeline -->
      <SnapshotTimeline
        :snapshots="snapshots"
        :active-snapshot-id="activeSnapshotId"
        :active-sequence="activeSnapshot?.sequence"
        @select="activeSnapshotId = $event" />
    </template>
  </div>
</template>
