<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type {
  AnalysisResult,
  AnalysisSnapshot,
  AnalysisTemplate,
  DimensionChange,
  InsightSession
} from '@shared/types/insight';
import { useAudioRecorder } from '@/composables/useAudioRecorder';
import DimensionRenderer from '@/components/insight/DimensionRenderer.vue';
import Popup from '@/components/Popup/index.vue';
import { getAgents, type AgentEntry } from '@/api/agents';
import {
  analyzeInsightSession,
  appendInsightTranscript,
  completeInsightSession,
  createInsightSession,
  deleteInsightTemplate,
  getInsightSession,
  getInsightSessions,
  getInsightSnapshots,
  getInsightTemplates,
  pauseInsightSession,
  resumeInsightSession
} from '@/api/insight';

const route = useRoute();
const router = useRouter();

const templates = ref<AnalysisTemplate[]>([]);
const agents = ref<AgentEntry[]>([]);
const sessions = ref<InsightSession[]>([]);
const currentSession = ref<InsightSession | null>(null);
const snapshots = ref<AnalysisSnapshot[]>([]);
const activeSnapshotId = ref('');
const selectedTemplateId = ref('');
const selectedAgentId = ref('');
const showTemplateSelector = ref(false);
const tab = ref<'active' | 'history'>('active');
const copySuccess = ref('');
const loading = ref(false);
const creating = ref(false);
const analyzing = ref(false);
const deletingTemplateId = ref('');
const error = ref('');
const recorderVolume = ref(0);

const currentTemplate = computed<AnalysisTemplate | null>(() => {
  if (!currentSession.value) return null;
  return templates.value.find((t) => t.id === currentSession.value?.templateId) ?? null;
});
const selectedAgent = computed<AgentEntry | null>(
  () => agents.value.find((agent) => agent.id === selectedAgentId.value) ?? null
);
const currentAgentName = computed(() => {
  if (!currentSession.value) return '';
  return (
    currentSession.value.config?.agentName ||
    agents.value.find((agent) => agent.id === currentSession.value?.config?.agentId)?.name ||
    ''
  );
});

const hasSession = computed(() => !!currentSession.value);
const activeSnapshot = computed(() => snapshots.value.find((item) => item.id === activeSnapshotId.value) ?? null);
const displayedResult = computed<AnalysisResult | null>(
  () => activeSnapshot.value?.result ?? currentSession.value?.latestResult ?? null
);
const displayedChanges = computed<DimensionChange[]>(() => activeSnapshot.value?.changes ?? []);
const displayedTranscript = computed(() => currentSession.value?.transcript || '');
const isAnalyzing = computed(() => currentSession.value?.status === 'analyzing' || analyzing.value);
const isPaused = computed(() => currentSession.value?.status === 'paused');
const isRecording = computed(() => audioRecorder.isRecording.value && !isPaused.value);
const recorderVolumeWidth = computed(() => `${Math.max(4, Math.min(100, recorderVolume.value))}%`);

const triggerLabel = computed(() => {
  const strategy = currentTemplate.value?.refreshStrategy;
  if (!strategy) return '';
  const labels: Record<string, string> = {
    smart: '智能',
    content: '内容驱动',
    interval: '定时',
    silence: '静默',
    hybrid: '混合',
    manual: '手动'
  };
  return labels[strategy.trigger] || strategy.trigger;
});

const elapsedTime = ref('00:00:00');
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let lastPartialLength = 0;

const audioRecorder = useAudioRecorder({
  onPartialResult: (text: string) => {
    if (!currentSession.value) return;
    const delta = text.substring(lastPartialLength);
    lastPartialLength = text.length;
    if (!delta) return;

    currentSession.value = {
      ...currentSession.value,
      transcript: `${currentSession.value.transcript}${delta}`,
      updatedAt: Date.now()
    };

    appendInsightTranscript(currentSession.value.id, delta)
      .then((response) => {
        if (!response.success || !response.data || currentSession.value?.id !== response.data.session.id) {
          return;
        }
        currentSession.value = response.data.session;
      })
      .catch(() => {
        // ignore realtime transcript sync failures
      });
  },
  onVolumeChange: (volume: number) => {
    recorderVolume.value = Math.round(volume);
  },
  onSilence: () => {
    if (!currentSession.value || analyzing.value) return;
    void triggerSilenceAnalysis();
  }
});

onMounted(async () => {
  await init();
});

onUnmounted(() => {
  stopElapsedTimer();
  audioRecorder.stopRecording();
  audioRecorder.disconnect();
});

async function init(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [templatesResp, sessionsResp, agentsResp] = await Promise.all([
      getInsightTemplates(),
      getInsightSessions(),
      getAgents()
    ]);
    if (!templatesResp.success || !templatesResp.data) {
      throw new Error(templatesResp.error || '加载模板失败');
    }
    if (!sessionsResp.success || !sessionsResp.data) {
      throw new Error(sessionsResp.error || '加载会话列表失败');
    }
    if (!agentsResp.success || !agentsResp.data) {
      throw new Error(agentsResp.error || '加载智能体列表失败');
    }

    applyTemplateCollection(templatesResp.data.templates);
    agents.value = agentsResp.data.agents;
    sessions.value = sessionsResp.data.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    selectedAgentId.value = resolveDefaultAgentId(agents.value);
    applyTemplateSelectionFromRoute();

    const active = sessions.value.find((session) => session.status !== 'completed') ?? null;
    if (active) {
      await loadSessionDetail(active.id);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '初始化失败';
  } finally {
    loading.value = false;
  }
}

function applyTemplateSelectionFromRoute(): void {
  const templateId = typeof route.query.templateId === 'string' ? route.query.templateId : '';
  const openSelector = route.query.openSelector === '1';

  if (templateId && templates.value.some((item) => item.id === templateId)) {
    selectedTemplateId.value = templateId;
  }

  if (openSelector) {
    showTemplateSelector.value = true;
  }

  if (templateId || openSelector) {
    void router.replace({ path: '/insight' });
  }
}

function applyTemplateCollection(nextTemplates: AnalysisTemplate[], preferredTemplateId?: string): void {
  templates.value = nextTemplates;

  if (preferredTemplateId && nextTemplates.some((item) => item.id === preferredTemplateId)) {
    selectedTemplateId.value = preferredTemplateId;
    return;
  }

  if (selectedTemplateId.value && nextTemplates.some((item) => item.id === selectedTemplateId.value)) {
    return;
  }

  selectedTemplateId.value = nextTemplates[0]?.id ?? '';
}

async function refreshSessions(): Promise<void> {
  const response = await getInsightSessions();
  if (response.success && response.data) {
    sessions.value = response.data.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

async function refreshTemplates(preferredTemplateId?: string): Promise<void> {
  const response = await getInsightTemplates();
  if (!response.success || !response.data) {
    throw new Error(response.error || '加载模板失败');
  }
  applyTemplateCollection(response.data.templates, preferredTemplateId);
}

async function loadSessionDetail(sessionId: string): Promise<void> {
  const [sessionResp, snapshotsResp] = await Promise.all([
    getInsightSession(sessionId),
    getInsightSnapshots(sessionId)
  ]);
  if (!sessionResp.success || !sessionResp.data) {
    throw new Error(sessionResp.error || '加载会话失败');
  }
  if (!snapshotsResp.success || !snapshotsResp.data) {
    throw new Error(snapshotsResp.error || '加载快照失败');
  }

  currentSession.value = sessionResp.data.session;
  snapshots.value = snapshotsResp.data.snapshots;
  activeSnapshotId.value = snapshots.value[snapshots.value.length - 1]?.id || '';
  startElapsedTimer();
}

async function startNewSession(): Promise<void> {
  if (!selectedTemplateId.value || !selectedAgentId.value || creating.value) return;

  creating.value = true;
  error.value = '';
  try {
    const response = await createInsightSession({
      templateId: selectedTemplateId.value,
      agentId: selectedAgentId.value
    });
    if (!response.success || !response.data) {
      throw new Error(response.error || '创建会话失败');
    }

    currentSession.value = response.data.session;
    snapshots.value = [];
    activeSnapshotId.value = '';
    lastPartialLength = 0;
    showTemplateSelector.value = false;
    tab.value = 'active';
    await refreshSessions();
    startElapsedTimer();
    await startRecordingCapture();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '创建会话失败';
  } finally {
    creating.value = false;
  }
}

async function completeCurrentSession(): Promise<void> {
  if (!currentSession.value) return;

  error.value = '';
  try {
    audioRecorder.stopRecording();
    audioRecorder.disconnect();

    const response = await completeInsightSession(currentSession.value.id);
    if (!response.success || !response.data) {
      throw new Error(response.error || '结束会话失败');
    }

    currentSession.value = null;
    snapshots.value = [];
    activeSnapshotId.value = '';
    recorderVolume.value = 0;
    stopElapsedTimer();
    await refreshSessions();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '结束会话失败';
  }
}

async function startRecordingCapture(): Promise<void> {
  if (!currentSession.value || audioRecorder.isRecording.value) return;
  await audioRecorder.connect();
  audioRecorder.resetSentOffset();
  lastPartialLength = 0;
  await audioRecorder.startRecording();
}

async function pauseCurrentSession(): Promise<void> {
  if (!currentSession.value) return;

  audioRecorder.stopRecording();
  recorderVolume.value = 0;
  const response = await pauseInsightSession(currentSession.value.id);
  if (response.success && response.data) {
    currentSession.value = response.data.session;
    await refreshSessions();
  }
}

async function resumeCurrentSession(): Promise<void> {
  if (!currentSession.value) return;

  const response = await resumeInsightSession(currentSession.value.id);
  if (!response.success || !response.data) {
    throw new Error(response.error || '恢复会话失败');
  }

  currentSession.value = response.data.session;
  await startRecordingCapture();
  await refreshSessions();
}

async function runAnalysis(trigger: 'manual' | 'silence'): Promise<void> {
  if (!currentSession.value || analyzing.value) return;

  analyzing.value = true;
  error.value = '';
  try {
    const response = await analyzeInsightSession(currentSession.value.id, trigger);
    if (!response.success || !response.data) {
      throw new Error(response.error || '分析失败');
    }

    currentSession.value = response.data.session;
    snapshots.value = [...snapshots.value, response.data.snapshot];
    activeSnapshotId.value = response.data.snapshot.id;
    audioRecorder.resetSentOffset();
    lastPartialLength = 0;
    await refreshSessions();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '分析失败';
  } finally {
    analyzing.value = false;
  }
}

async function manualAnalyze(): Promise<void> {
  await runAnalysis('manual');
}

async function triggerSilenceAnalysis(): Promise<void> {
  await runAnalysis('silence');
}

async function selectSession(sessionId: string): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    audioRecorder.stopRecording();
    recorderVolume.value = 0;
    await loadSessionDetail(sessionId);
  } catch (err) {
    error.value = err instanceof Error ? err.message : '切换会话失败';
  } finally {
    loading.value = false;
  }
}

function getChangesMap(): Map<string, DimensionChange> {
  return new Map(displayedChanges.value.map((item) => [item.key, item]));
}

function copyTranscript(): void {
  copyToClipboard(displayedTranscript.value, 'transcript');
}

function copyResult(): void {
  if (!displayedResult.value) return;
  const lines: string[] = [];
  if (displayedResult.value.summary) lines.push(`摘要：${displayedResult.value.summary}\n`);
  for (const [, dim] of Object.entries(displayedResult.value.dimensions)) {
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

function openSessionDetail(): void {
  if (!currentSession.value) return;
  router.push(`/insight/session/${currentSession.value.id}`);
}

function viewHistorySession(sessionId: string): void {
  router.push(`/insight/session/${sessionId}`);
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDuration(start: number, end?: number): string {
  const diff = (end ?? Date.now()) - start;
  const m = Math.floor(diff / 60000);
  return m < 60 ? `${m}分钟` : `${Math.floor(m / 60)}小时${m % 60}分`;
}

function resolveDefaultAgentId(agentList: AgentEntry[]): string {
  return agentList.find((agent) => agent.id === 'app-copilot')?.id ?? agentList[0]?.id ?? '';
}

function openTemplateSelector(): void {
  showTemplateSelector.value = true;
}

function closeTemplateSelector(): void {
  showTemplateSelector.value = false;
}

function selectTemplate(templateId: string): void {
  selectedTemplateId.value = templateId;
}

function goToTemplateCreate(): void {
  closeTemplateSelector();
  router.push('/insight/templates/create');
}

function goToTemplateEdit(templateId: string): void {
  closeTemplateSelector();
  router.push(`/insight/templates/${templateId}/edit`);
}

async function removeTemplate(templateId: string): Promise<void> {
  const template = templates.value.find((item) => item.id === templateId);
  if (!template || template.builtIn || deletingTemplateId.value) return;
  if (!window.confirm(`确定要删除模板“${template.name}”吗？此操作无法撤销。`)) return;

  deletingTemplateId.value = templateId;
  error.value = '';
  try {
    const response = await deleteInsightTemplate(templateId);
    if (!response.success || !response.data) {
      throw new Error(response.error || '删除模板失败');
    }

    const preferredTemplateId = selectedTemplateId.value === templateId ? undefined : selectedTemplateId.value;
    await refreshTemplates(preferredTemplateId);
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除模板失败';
  } finally {
    deletingTemplateId.value = '';
  }
}

function startElapsedTimer(): void {
  stopElapsedTimer();
  elapsedTimer = setInterval(() => {
    if (!currentSession.value) return;
    const diff = Date.now() - currentSession.value.startTime;
    const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
    elapsedTime.value = `${h}:${m}:${s}`;
  }, 1000);
}

function stopElapsedTimer(): void {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function getSessionStatusInfo(session: InsightSession): { label: string; cls: string; dot: string } {
  switch (session.status) {
    case 'completed':
      return { label: '已完成', cls: 'bg-success/12 text-success', dot: 'bg-success' };
    case 'paused':
      return { label: '已暂停', cls: 'bg-warning/12 text-warning', dot: 'bg-warning' };
    case 'analyzing':
      return { label: '分析中', cls: 'bg-info/12 text-info', dot: 'bg-info animate-pulse' };
    default:
      return { label: '进行中', cls: 'bg-primary/12 text-primary', dot: 'bg-primary' };
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
      <div class="flex items-center justify-between px-6 py-3">
        <div class="flex items-center gap-3">
          <div
            class="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-gradient-to-br from-primary/18 to-primary/5 text-primary shadow-[0_10px_24px_-18px_hsl(var(--primary)/0.35)]">
            <span class="i-carbon-analytics inline-block h-4 w-4" />
          </div>
          <div>
            <h1 class="text-base font-bold text-foreground">实时洞察</h1>
            <p class="text-[10px] tracking-[0.08em] text-muted-foreground/52">AI 驱动的实时对话分析</p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <!-- Tab Switcher -->
          <div
            class="flex rounded-xl border border-border/70 bg-background/75 p-1 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
            <button
              class="rounded-lg px-4 py-1.5 text-xs font-medium transition-all"
              :class="
                tab === 'active'
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              "
              @click="tab = 'active'">
              实时分析
            </button>
            <button
              class="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium transition-all"
              :class="
                tab === 'history'
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              "
              @click="tab = 'history'">
              历史记录
              <span
                v-if="sessions.length"
                class="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-bold text-primary">
                {{ sessions.length }}
              </span>
            </button>
          </div>
          <!-- New Session Button -->
          <button
            v-if="!hasSession"
            class="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground shadow-[0_10px_24px_-14px_hsl(var(--primary)/0.55)] transition-all hover:opacity-90 active:scale-[0.97]"
            @click="openTemplateSelector">
            <span class="i-carbon-add inline-block h-3.5 w-3.5" />
            新建会话
          </button>
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

    <!-- Active Tab -->
    <div v-if="tab === 'active'" class="flex flex-1 flex-col overflow-hidden">
      <!-- Empty State -->
      <div v-if="!hasSession && !loading" class="flex flex-1 flex-col px-12 py-10">
        <div class="mx-auto flex w-full max-w-3xl flex-col">
          <div class="mb-5 flex items-center justify-between gap-4">
            <div>
              <h3 class="text-sm font-bold tracking-wide text-foreground/80">选择分析模板</h3>
              <p class="mt-1 text-xs text-muted-foreground/55">创建新的实时洞察会话</p>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="flex items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-4 py-2 text-xs font-medium text-foreground transition-all hover:border-primary/20 hover:bg-accent"
                @click="goToTemplateCreate">
                <span class="i-carbon-add inline-block h-4 w-4" />
                新建模板
              </button>
              <button
                class="flex items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-4 py-2 text-xs font-medium text-muted-foreground transition-all hover:border-primary/20 hover:bg-accent hover:text-foreground"
                @click="openTemplateSelector">
                <span class="i-carbon-overflow-menu-horizontal inline-block h-4 w-4" />
                更多模板
              </button>
            </div>
          </div>

          <div class="grid w-full grid-cols-2 gap-3">
            <div
              v-for="(tpl, idx) in templates"
              :key="tpl.id"
              class="group flex items-start gap-3 rounded-2xl border border-border/80 bg-card/94 p-4 text-left shadow-[0_12px_34px_-24px_rgba(0,0,0,0.24)] transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:bg-card hover:shadow-[0_22px_46px_-28px_rgba(0,0,0,0.3)]"
              :style="{ animationDelay: `${idx * 60}ms` }"
              @click="
                selectedTemplateId = tpl.id;
                openTemplateSelector();
              ">
              <span
                v-if="isIconClass(tpl.icon)"
                class="mt-0.5 inline-block h-8 w-8 shrink-0 text-primary/80 transition-transform group-hover:scale-110"
                :class="tpl.icon" />
              <span v-else class="mt-0.5 text-2xl transition-transform group-hover:scale-110">
                {{ tpl.icon || '📊' }}
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-bold text-card-foreground/85">{{ tpl.name }}</div>
                  </div>
                  <div
                    v-if="!tpl.builtIn"
                    class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      class="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      @click.stop="goToTemplateEdit(tpl.id)">
                      <span class="i-carbon-edit inline-block h-3 w-3" />
                      编辑
                    </button>
                    <button
                      class="inline-flex items-center gap-1 rounded-md border border-destructive/20 bg-destructive/6 px-2 py-1 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="deletingTemplateId === tpl.id"
                      @click.stop="removeTemplate(tpl.id)">
                      <span
                        v-if="deletingTemplateId === tpl.id"
                        class="h-3 w-3 animate-spin rounded-full border border-destructive/30 border-t-destructive" />
                      <span v-else class="i-carbon-trash-can inline-block h-3 w-3" />
                      {{ deletingTemplateId === tpl.id ? '删除中' : '删除' }}
                    </button>
                  </div>
                </div>
                <div class="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground/55">
                  {{ tpl.description }}
                </div>
                <div class="mt-2 flex items-center gap-2 text-[10px] font-medium text-primary/50">
                  <span>{{ tpl.dimensions.length }} 个维度</span>
                  <span v-if="!tpl.builtIn" class="rounded-full bg-success/10 px-1.5 py-0.5 text-success">
                    自定义
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-else-if="loading" class="flex flex-1 flex-col items-center justify-center gap-3">
        <div class="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        <span class="text-sm text-muted-foreground/50">加载中...</span>
      </div>

      <!-- Session Active -->
      <template v-else-if="hasSession">
        <!-- Session Toolbar -->
        <div
          class="relative shrink-0 border-b border-border/70 bg-surface/94 shadow-[0_16px_38px_-28px_rgba(0,0,0,0.38)] backdrop-blur-xl">
          <div class="flex items-center justify-between px-5 py-2.5">
            <!-- Left: Status Info -->
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-2">
                <span class="relative flex h-2.5 w-2.5" :class="{ 'animate-pulse': isAnalyzing || isRecording }">
                  <span
                    v-if="isRecording"
                    class="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/50" />
                  <span
                    class="relative inline-flex h-2.5 w-2.5 rounded-full"
                    :class="{
                      'bg-info': isAnalyzing,
                      'bg-destructive': isRecording,
                      'bg-warning': isPaused,
                      'bg-muted-foreground/30': !isAnalyzing && !isRecording && !isPaused
                    }" />
                </span>
                <span class="text-xs font-bold text-foreground/80">
                  {{ isAnalyzing ? '分析中' : isRecording ? '采集中' : isPaused ? '已暂停' : '就绪' }}
                </span>
              </div>
              <div class="h-4 w-px bg-border/70" />
              <span class="font-mono text-sm font-bold tabular-nums tracking-wider text-foreground/55">
                {{ elapsedTime }}
              </span>
              <div class="h-4 w-px bg-border/70" />
              <span
                class="rounded-lg border border-primary/10 bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                {{ currentTemplate?.name }}
              </span>
              <span
                v-if="currentAgentName"
                class="rounded-lg border border-border/60 bg-background/72 px-2 py-1 text-[10px] font-medium text-muted-foreground/72">
                智能体 · {{ currentAgentName }}
              </span>
              <span
                v-if="triggerLabel"
                class="flex items-center gap-1 rounded-lg border border-border/60 bg-accent/45 px-2 py-1 text-[10px] font-medium text-muted-foreground/72">
                <span class="i-carbon-timer inline-block h-3 w-3" />
                {{ triggerLabel }}
              </span>
              <span
                v-if="snapshots.length"
                class="rounded-lg border border-border/60 bg-background/72 px-2 py-1 text-[10px] font-medium text-muted-foreground/58">
                #{{ snapshots.length }} 快照
              </span>
            </div>

            <!-- Right: Controls -->
            <div class="flex items-center gap-2">
              <!-- Action Buttons -->
              <button
                v-if="isRecording"
                class="inline-flex h-8 items-center gap-1.5 rounded-xl border border-warning/25 bg-warning/10 px-3 text-[11px] font-semibold text-warning transition-all hover:bg-warning/15 active:scale-95"
                title="暂停录音"
                @click="pauseCurrentSession">
                <span class="i-carbon-pause inline-block h-4 w-4" />
                暂停
              </button>
              <button
                v-if="isPaused"
                class="inline-flex h-8 items-center gap-1.5 rounded-xl border border-success/25 bg-success/10 px-3 text-[11px] font-semibold text-success transition-all hover:bg-success/15 active:scale-95"
                title="继续录音"
                @click="resumeCurrentSession">
                <span class="i-carbon-play inline-block h-4 w-4" />
                继续
              </button>
              <button
                class="inline-flex h-8 items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/10 px-3 text-[11px] font-semibold text-primary transition-all hover:bg-primary/15 active:scale-95"
                title="手动触发分析"
                @click="manualAnalyze">
                <span class="i-carbon-analytics inline-block h-4 w-4" />
                分析
              </button>
              <button
                class="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/70 bg-background/78 px-3 text-[11px] font-semibold text-foreground/72 transition-all hover:bg-accent hover:text-foreground active:scale-95"
                title="查看会话详情"
                @click="openSessionDetail">
                <span class="i-carbon-view inline-block h-4 w-4" />
                会话详情
              </button>
              <button
                class="inline-flex h-8 items-center gap-1.5 rounded-xl border border-destructive/20 bg-destructive/10 px-3 text-[11px] font-semibold text-destructive transition-all hover:bg-destructive/15 active:scale-95"
                title="结束会话"
                @click="completeCurrentSession">
                <span class="i-carbon-stop inline-block h-4 w-4" />
                结束
              </button>
            </div>
          </div>
        </div>

        <!-- Main Panels -->
        <div class="flex min-h-0 flex-1 overflow-hidden bg-border/60">
          <!-- Left: Transcript/Input Panel (2/5) -->
          <div class="flex w-[40%] min-w-0 flex-col border-r border-border/70 bg-background/92 backdrop-blur-sm">
            <!-- Panel Header -->
            <div class="flex shrink-0 items-center justify-between border-b border-border/60 bg-surface/28 px-5 py-3">
              <div class="flex items-center gap-2.5">
                <div
                  class="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-primary/10 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <span class="i-carbon-text-align-left inline-block h-3.5 w-3.5" />
                </div>
                <span class="text-xs font-bold tracking-wide text-foreground/70">实时文字流</span>
              </div>
              <div class="flex items-center gap-2.5">
                <div class="flex w-24 items-center gap-1.5">
                  <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/60">
                    <div
                      class="h-full rounded-full transition-all duration-150"
                      :class="isRecording ? 'bg-primary' : 'bg-muted-foreground/20'"
                      :style="{ width: recorderVolumeWidth }" />
                  </div>
                </div>
                <button
                  v-if="displayedTranscript"
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
                  {{ copySuccess === 'transcript' ? '已复制' : '复制' }}
                </button>
              </div>
            </div>

            <!-- Transcript Content -->
            <div class="flex-1 overflow-y-auto px-5 py-4">
              <div v-if="displayedTranscript" class="relative">
                <div class="absolute left-0 top-0 h-full w-0.5 rounded-full bg-primary/12" />
                <p class="whitespace-pre-wrap break-words pl-4 text-[13px] leading-[1.9] text-foreground/84">
                  {{ displayedTranscript }}
                </p>
              </div>
              <div v-else class="flex flex-col items-center justify-center gap-2 py-16">
                <span class="i-carbon-microphone inline-block h-8 w-8 text-muted-foreground/15" />
                <span class="text-xs text-muted-foreground/30">等待语音输入...</span>
              </div>
            </div>
          </div>

          <!-- Right: Analysis Results Panel (3/5) -->
          <div class="flex min-w-0 flex-1 flex-col bg-card/72 backdrop-blur-sm">
            <!-- Panel Header -->
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
                  v-if="displayedResult?.confidence"
                  class="rounded-full border border-primary/10 bg-primary/10 px-3 py-0.5 text-[10px] font-bold text-primary">
                  {{ Math.round(displayedResult.confidence * 100) }}% 置信度
                </span>
                <button
                  v-if="displayedResult"
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

            <!-- Results Content -->
            <div v-if="displayedResult" class="flex-1 overflow-y-auto px-5 py-4">
              <!-- Summary Card -->
              <div
                v-if="displayedResult.summary"
                class="mb-5 rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/7 via-primary/3 to-transparent px-5 py-4 shadow-[0_14px_34px_-24px_rgba(0,0,0,0.2)]">
                <div class="mb-2 flex items-center gap-2">
                  <span class="i-carbon-text-creation inline-block h-4 w-4 text-primary/50" />
                  <span class="text-[10px] font-bold uppercase tracking-[0.15em] text-primary/50"> 摘要 </span>
                </div>
                <p class="text-sm leading-7 text-foreground/82">{{ displayedResult.summary }}</p>
              </div>

              <!-- Dimensions -->
              <div class="flex flex-col gap-3">
                <DimensionRenderer
                  v-for="(dim, key) in displayedResult.dimensions"
                  :key="String(key)"
                  :dimension="dim"
                  :change="getChangesMap().get(String(key))"
                  :icon="currentTemplate?.dimensions.find((d) => d.key === String(key))?.icon"
                  :show-trend="currentTemplate?.dimensions.find((d) => d.key === String(key))?.showTrend" />
              </div>
            </div>

            <!-- Empty State -->
            <div
              v-else
              class="flex flex-1 flex-col items-center justify-center gap-3 bg-gradient-to-b from-transparent to-background/20">
              <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/5 text-accent/30">
                <span class="i-carbon-chart-line-data inline-block h-7 w-7" />
              </div>
              <p class="text-sm font-medium text-muted-foreground/40">等待首次分析</p>
              <p class="text-xs text-muted-foreground/25">录音将自动触发分析</p>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- History Tab -->
    <div v-if="tab === 'history'" class="flex-1 overflow-y-auto">
      <div v-if="sessions.length === 0" class="flex flex-1 flex-col items-center justify-center gap-3 p-12">
        <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/10 text-muted-foreground/20">
          <span class="i-carbon-document inline-block h-7 w-7" />
        </div>
        <p class="text-sm text-muted-foreground/40">暂无历史记录</p>
      </div>
      <div v-else class="mx-auto max-w-3xl px-5 py-4">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground/50"> 会话记录 </h2>
          <span class="text-[11px] text-muted-foreground/40">{{ sessions.length }} 条记录</span>
        </div>
        <div class="flex flex-col gap-2">
          <div
            v-for="session in sessions"
            :key="session.id"
            class="group flex items-center gap-4 rounded-2xl border border-border/60 bg-card/92 px-5 py-3.5 shadow-[0_12px_30px_-24px_rgba(0,0,0,0.24)] transition-all hover:-translate-y-0.5 hover:border-primary/15 hover:bg-card hover:shadow-[0_18px_42px_-26px_rgba(0,0,0,0.28)]">
            <!-- Icon -->
            <div
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-primary/5 text-lg">
              {{ session.templateName.includes('面试') ? '🎯' : session.templateName.includes('会议') ? '📋' : '📊' }}
            </div>
            <!-- Info -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-semibold text-card-foreground/85">
                  {{ session.templateName }}
                </span>
                <span
                  class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                  :class="getSessionStatusInfo(session).cls">
                  {{ getSessionStatusInfo(session).label }}
                </span>
              </div>
              <div class="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/50">
                <span>{{ formatDate(session.startTime) }}</span>
                <span class="text-muted-foreground/25">·</span>
                <span>{{ formatDuration(session.startTime, session.endTime) }}</span>
                <span class="text-muted-foreground/25">·</span>
                <span>{{ session.snapshotCount }} 次分析</span>
              </div>
            </div>
            <!-- Actions -->
            <div class="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-all hover:bg-primary/8 hover:text-primary"
                @click="viewHistorySession(session.id)">
                <span class="i-carbon-view inline-block h-3.5 w-3.5" />
                会话详情
              </button>
              <button
                v-if="session.status !== 'completed'"
                class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-all hover:bg-primary/8 hover:text-primary"
                @click="selectSession(session.id)">
                <span class="i-carbon-arrow-right inline-block h-3.5 w-3.5" />
                打开
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Template Selector Modal -->
    <Popup
      v-model:visible="showTemplateSelector"
      position="center"
      transition="zoom"
      :show-mask="true"
      :close-on-click-overlay="true"
      :container-style="{ width: '720px', maxWidth: 'calc(100vw - 32px)', marginTop: '24px', marginBottom: '24px' }">
      <div
        class="rounded-3xl border border-border/70 bg-popover/96 shadow-[0_40px_100px_-40px_rgba(0,0,0,0.44)] backdrop-blur-xl">
        <!-- Modal Header -->
        <div class="border-b border-border/50 px-7 py-5">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-lg font-bold text-popover-foreground">选择分析模板</h3>
              <p class="mt-0.5 text-xs text-muted-foreground/50">选择一个模板开始实时洞察分析</p>
            </div>
            <button
              class="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
              @click="closeTemplateSelector">
              <span class="i-carbon-close inline-block h-4 w-4" />
            </button>
          </div>

          <div class="mt-4 flex items-center gap-2 text-[11px] font-medium text-muted-foreground/60">
            <span class="i-carbon-microphone inline-block h-3.5 w-3.5 text-primary/70" />
            当前仅支持实时录音采集
          </div>
        </div>

        <!-- Agent List -->
        <div class="border-b border-border/50 px-7 py-4">
          <div class="mb-3 flex items-center justify-between">
            <div>
              <h4 class="text-sm font-semibold text-popover-foreground">选择分析智能体</h4>
              <p class="mt-0.5 text-xs text-muted-foreground/50">创建时指定本次洞察分析使用的智能体</p>
            </div>
            <span
              v-if="selectedAgent"
              class="rounded-full border border-primary/15 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
              已选 {{ selectedAgent.name }}
            </span>
          </div>

          <div class="flex flex-col gap-2">
            <button
              v-for="agent in agents"
              :key="agent.id"
              class="group flex items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all"
              :class="
                selectedAgentId === agent.id
                  ? 'border-primary/30 bg-primary/5 shadow-[0_12px_28px_-20px_hsl(var(--primary)/0.3)]'
                  : 'border-border/60 bg-background/55 hover:border-primary/20 hover:bg-accent/30'
              "
              @click="selectedAgentId = agent.id">
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/80 text-primary/75">
                <span class="i-carbon-bot inline-block h-4 w-4" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="block truncate text-sm font-semibold text-popover-foreground">{{ agent.name }}</span>
                </span>
                <span class="mt-0.5 block line-clamp-2 text-[11px] leading-5 text-muted-foreground/55">
                  {{ agent.description || '用于实时洞察分析' }}
                </span>
                <span class="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground/42">
                  <span v-if="agent.runtimeType" class="rounded-md bg-accent/45 px-1.5 py-0.5">
                    {{ agent.runtimeType }}
                  </span>
                  <span v-if="agent.model" class="truncate">{{ agent.model }}</span>
                </span>
              </span>
              <span
                v-if="selectedAgentId === agent.id"
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <span class="i-carbon-checkmark inline-block h-3 w-3" />
              </span>
            </button>
          </div>
          <p class="mt-3 text-[11px] leading-5 text-muted-foreground/48">
            智能体决定分析风格和推理能力；若没有特殊要求，直接使用默认推荐即可。
          </p>
        </div>

        <div class="flex flex-col gap-2 px-7 py-4">
          <div class="mb-1 flex items-start justify-between gap-3">
            <div>
              <h4 class="text-sm font-semibold text-popover-foreground">选择分析模板</h4>
              <p class="mt-0.5 text-xs text-muted-foreground/50">模板决定分析维度和触发策略</p>
            </div>
            <button
              class="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-background/70 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-all hover:border-primary/20 hover:bg-accent hover:text-foreground"
              @click="goToTemplateCreate">
              <span class="i-carbon-add inline-block h-3.5 w-3.5" />
              自定义模板
            </button>
          </div>
          <div
            v-for="tpl in templates"
            :key="tpl.id"
            class="group flex items-start gap-4 rounded-2xl border px-4 py-3.5 text-left transition-colors"
            :class="
              selectedTemplateId === tpl.id
                ? 'border-primary/30 bg-primary/[0.04]'
                : 'border-border/60 bg-background/55 hover:border-primary/20 hover:bg-accent/20'
            "
            @click="selectTemplate(tpl.id)">
            <span
              v-if="isIconClass(tpl.icon)"
              class="mt-0.5 inline-block h-7 w-7 shrink-0"
              :class="[tpl.icon, selectedTemplateId === tpl.id ? 'text-primary' : 'text-primary/80']" />
            <span v-else class="mt-0.5 text-2xl">
              {{ tpl.icon || '📊' }}
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <div class="text-sm font-bold text-popover-foreground">{{ tpl.name }}</div>
                  <span
                    v-if="!tpl.builtIn"
                    class="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                    自定义
                  </span>
                  <span
                    v-if="selectedTemplateId === tpl.id"
                    class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    当前选择
                  </span>
                </div>
              </div>
              <div class="mt-1 text-xs leading-5 text-muted-foreground/60">
                {{ tpl.description }}
              </div>
              <div class="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground/45">
                <span>{{ tpl.dimensions.length }} 个维度</span>
                <span class="text-muted-foreground/25">·</span>
                <span>
                  {{
                    tpl.refreshStrategy.trigger === 'silence'
                      ? '静默触发'
                      : tpl.refreshStrategy.trigger === 'manual'
                        ? '手动触发'
                        : '智能触发'
                  }}
                </span>
              </div>
            </div>
            <div
              v-if="selectedTemplateId === tpl.id"
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
              <span class="i-carbon-checkmark inline-block h-3 w-3" />
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2.5 border-t border-border/50 px-7 py-4">
          <button
            class="rounded-xl px-5 py-2 text-xs font-medium text-muted-foreground transition-all hover:bg-accent"
            @click="closeTemplateSelector">
            取消
          </button>
          <button
            class="flex items-center gap-2 rounded-xl bg-primary px-6 py-2 text-xs font-bold text-primary-foreground shadow-[0_10px_24px_-14px_hsl(var(--primary)/0.55)] transition-all hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!selectedTemplateId || !selectedAgentId || creating"
            @click="startNewSession">
            <span
              v-if="creating"
              class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
            开始录音
          </button>
        </div>
      </div>
    </Popup>
  </div>
</template>
