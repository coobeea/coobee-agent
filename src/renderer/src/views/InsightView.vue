<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type {
  AnalysisDimension,
  AnalysisResult,
  AnalysisSnapshot,
  AnalysisTemplate,
  DimensionChange,
  InsightSession
} from '@shared/types/insight';
import { useAudioRecorder } from '@/composables/useAudioRecorder';
import { useWorkerStore } from '@/stores/worker';
import {
  getTextTail,
  mapAsrStatusToCaption,
  smoothVoiceLevel,
  SPEECH_VOLUME_THRESHOLD,
  type LiveCaptionTone
} from '@/composables/audio-recorder-ui';
import DimensionRenderer from '@/components/insight/DimensionRenderer.vue';
import Popup from '@/components/Popup/index.vue';
import { getAgents, type AgentEntry } from '@/api/agents';
import {
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
const workerStore = useWorkerStore();

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
const loading = ref(false);
const creating = ref(false);
const deletingTemplateId = ref('');
const error = ref('');
const transcriptPanelRef = ref<HTMLElement | null>(null);
const liveCaptionText = ref('');
const liveCaptionTone = ref<LiveCaptionTone>('active');
const voiceLevel = ref(0);
const transcriptBaseAtOffset = ref('');
const liveTranscriptSegment = ref('');

const currentTemplate = computed<AnalysisTemplate | null>(() => {
  if (!currentSession.value) return null;
  return templates.value.find((t) => t.id === currentSession.value?.templateId) ?? null;
});
const selectedTemplate = computed<AnalysisTemplate | null>(
  () => templates.value.find((item) => item.id === selectedTemplateId.value) ?? null
);
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
const displayedTranscript = computed(() =>
  mergeTranscriptDisplay(transcriptBaseAtOffset.value, liveTranscriptSegment.value)
);
const isPaused = computed(() => currentSession.value?.status === 'paused');
const isRecording = computed(() => audioRecorder.isRecording.value && !isPaused.value);
const canMuteRecording = computed(() => audioRecorder.isRecording.value && !isPaused.value);
const transcriptStatusTitle = computed(() => {
  if (isPaused.value) return '语音已暂停';
  if (audioRecorder.isRecording.value) return '正在聆听';
  if (audioRecorder.isConnected.value) return '正在连接麦克风';
  return '等待语音输入';
});
const waveBars = computed(() => {
  const level = audioRecorder.isRecording.value ? voiceLevel.value : 0;
  const weights = [0.35, 0.58, 0.82, 1, 0.76, 0.52, 0.38];

  return weights.map((weight, index) => {
    const activity = Math.max(0.12, Math.min(1, level * weight + (audioRecorder.isRecording.value ? 0.18 : 0)));
    return {
      height: `${Math.round(6 + activity * 18)}px`,
      opacity: `${0.3 + activity * 0.58}`,
      transitionDelay: `${index * 12}ms`
    };
  });
});
const displayedDimensions = computed<
  Array<{
    key: string;
    dimension: AnalysisResult['dimensions'][string];
    templateDimension?: AnalysisDimension;
  }>
>(() => {
  if (!displayedResult.value) return [];

  const resultDimensions = displayedResult.value.dimensions;
  const templateDimensions = currentTemplate.value?.dimensions ?? [];
  const ordered = templateDimensions
    .filter((item) => Boolean(resultDimensions[item.key]))
    .map((item) => ({
      key: item.key,
      dimension: resultDimensions[item.key],
      templateDimension: item
    }));

  const templateKeys = new Set(templateDimensions.map((item) => item.key));
  const extras = Object.entries(resultDimensions)
    .filter(([key]) => !templateKeys.has(key))
    .map(([key, dimension]) => ({
      key,
      dimension,
      templateDimension: undefined
    }));

  return [...ordered, ...extras];
});
const changesMap = computed(() => new Map(displayedChanges.value.map((item) => [item.key, item])));
const previewTemplate = computed<AnalysisTemplate | null>(
  () =>
    currentTemplate.value ??
    selectedTemplate.value ??
    templates.value.find((item) => item.dimensions.length >= 3) ??
    templates.value[0] ??
    null
);
const simulatedDimensions = computed<
  Array<{
    key: string;
    dimension: AnalysisResult['dimensions'][string];
    templateDimension?: AnalysisDimension;
  }>
>(() =>
  (previewTemplate.value?.dimensions ?? []).map((item, index) => ({
    key: item.key,
    dimension: buildPreviewDimension(item, index),
    templateDimension: item
  }))
);
const moduleItems = computed(() =>
  displayedDimensions.value.length ? displayedDimensions.value : simulatedDimensions.value
);
const expandedModuleKey = ref('');

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
let lastCommittedSegment = '';

function isAsrDebugEnabled(): boolean {
  return window.localStorage.getItem('coobee.asr.debug') === '1';
}

function debugInsightTranscript(event: string, payload?: Record<string, unknown>): void {
  if (!isAsrDebugEnabled()) return;
  if (payload) {
    console.log(`[InsightView] ${event}`, payload);
    return;
  }
  console.log(`[InsightView] ${event}`);
}

function shouldInsertSpace(before: string, after: string): boolean {
  return /[a-zA-Z0-9]$/.test(before) && /^[a-zA-Z0-9]/.test(after);
}

function findTextOverlap(before: string, after: string): number {
  const beforeChars = Array.from(before);
  const afterChars = Array.from(after);
  const maxOverlap = Math.min(beforeChars.length, afterChars.length, 40);

  for (let length = maxOverlap; length > 0; length--) {
    const beforeTail = beforeChars.slice(-length).join('');
    const afterHead = afterChars.slice(0, length).join('');
    if (beforeTail === afterHead) return length;
  }

  return 0;
}

function mergeTranscriptDisplay(before: string, after: string): string {
  const base = before.trim();
  const next = after.trim();
  if (!base) return next;
  if (!next || next === base || base.includes(next)) return base;
  if (next.startsWith(base) || next.includes(base)) return next;

  const overlap = findTextOverlap(base, next);
  const nextChars = Array.from(next);
  const separator = overlap === 0 && shouldInsertSpace(base, next) ? ' ' : '';
  return `${base}${separator}${nextChars.slice(overlap).join('')}`;
}

function resetTranscriptWindow(baseText?: string): void {
  transcriptBaseAtOffset.value = baseText ?? currentSession.value?.transcript ?? '';
  liveTranscriptSegment.value = '';
  lastCommittedSegment = '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function ensureAsrWorkerReady(): Promise<void> {
  await workerStore.requestWorkers();

  const asrWorker = workerStore.getWorker(workerStore.asrWorkerName);
  if (!asrWorker) {
    throw new Error('未找到 ASR Worker，请先检查 Worker 配置');
  }

  if (asrWorker.status === 'stopped' || asrWorker.status === 'error') {
    await workerStore.startWorker(asrWorker.name);
  }

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await workerStore.requestWorkers();

    if (workerStore.asrReady) {
      return;
    }

    const latestWorker = workerStore.getWorker(workerStore.asrWorkerName);
    if (latestWorker?.status === 'error') {
      throw new Error(latestWorker.error || 'ASR Worker 启动失败');
    }

    await sleep(500);
  }

  throw new Error('ASR Worker 尚未就绪，请稍后重试');
}

const audioRecorder = useAudioRecorder({
  onTranscriptUpdate: (payload) => {
    if (!currentSession.value) return;

    liveTranscriptSegment.value = payload.draftText;

    debugInsightTranscript('transcript_update', {
      seq: payload.seq,
      turnId: payload.turnId,
      event: payload.event,
      committedLength: payload.committedText.length,
      draftLength: payload.draftText.length,
      displayLength: payload.displayText.length
    });

    const liveText = payload.draftText.trim() || payload.displayText.trim();
    if (liveText) {
      liveCaptionTone.value = payload.isTurnFinal || payload.isSessionFinal ? 'recognized' : 'active';
      liveCaptionText.value = `${payload.isTurnFinal || payload.isSessionFinal ? '识别到' : '当前识别'}：${getTextTail(liveText)}`;
    }

    const committedText = payload.committedText;
    const mergedCommittedTranscript = mergeTranscriptDisplay(transcriptBaseAtOffset.value, committedText);
    transcriptBaseAtOffset.value = mergedCommittedTranscript;
    const delta = committedText.startsWith(lastCommittedSegment)
      ? committedText.substring(lastCommittedSegment.length)
      : committedText;
    lastCommittedSegment = committedText;
    if (!delta.trim()) return;

    currentSession.value = {
      ...currentSession.value,
      transcript: mergedCommittedTranscript,
      updatedAt: Date.now()
    };

    appendInsightTranscript(currentSession.value.id, delta)
      .then((response) => {
        if (!response.success || !response.data || currentSession.value?.id !== response.data.session.id) {
          return;
        }

        if (response.data.session.transcript.length >= currentSession.value.transcript.length) {
          currentSession.value = response.data.session;
          transcriptBaseAtOffset.value = response.data.session.transcript;
          debugInsightTranscript('transcript_sync_applied', {
            transcriptLength: response.data.session.transcript.length,
            appendedLength: response.data.appendedLength
          });
          return;
        }

        debugInsightTranscript('transcript_sync_skipped', {
          localLength: currentSession.value.transcript.length,
          remoteLength: response.data.session.transcript.length,
          appendedLength: response.data.appendedLength
        });
      })
      .catch(() => {
        // ignore realtime transcript sync failures
      });
  },
  onPartialResult: (text: string) => {
    if (!currentSession.value || !text.trim()) return;
    liveTranscriptSegment.value = text;
    liveCaptionTone.value = 'active';
    liveCaptionText.value = `当前识别：${getTextTail(text)}`;
  },
  onFinalResult: (text: string) => {
    if (!text.trim()) return;
    liveTranscriptSegment.value = text;
    liveCaptionTone.value = 'recognized';
    liveCaptionText.value = `识别到：${getTextTail(text)}`;
  },
  onStatus: (payload) => {
    const snapshot = mapAsrStatusToCaption(payload);
    liveCaptionTone.value = snapshot.tone;
    liveCaptionText.value = snapshot.text;
  },
  onVolumeChange: (volume) => {
    voiceLevel.value = smoothVoiceLevel(voiceLevel.value, volume);
    if (volume >= SPEECH_VOLUME_THRESHOLD && !liveCaptionText.value) {
      liveCaptionTone.value = 'active';
      liveCaptionText.value = '听到声音，正在接收';
    }
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

watch(displayedTranscript, async () => {
  await nextTick();
  if (transcriptPanelRef.value) {
    transcriptPanelRef.value.scrollTop = transcriptPanelRef.value.scrollHeight;
  }
});

function resetVoicePanelFeedback(): void {
  liveCaptionText.value = '';
  liveCaptionTone.value = 'active';
  voiceLevel.value = 0;
}

watch(
  [moduleItems, displayedChanges],
  ([items, changes]) => {
    if (!items.length) {
      expandedModuleKey.value = '';
      return;
    }

    const changedKey = changes.find((item) => items.some((entry) => entry.key === item.key))?.key;
    if (changedKey) {
      expandedModuleKey.value = changedKey;
      return;
    }

    if (items.some((item) => item.key === expandedModuleKey.value)) {
      return;
    }

    expandedModuleKey.value = items[0]?.key ?? '';
  },
  { immediate: true }
);

function toggleModule(key: string): void {
  expandedModuleKey.value = expandedModuleKey.value === key ? '' : key;
}

function getDimensionSummary(dimension: AnalysisResult['dimensions'][string]): string {
  if (Array.isArray(dimension.value)) {
    return (dimension.value as string[]).slice(0, 2).join('、') || '暂无结果';
  }
  if (dimension.type === 'boolean') {
    return dimension.value ? '已达成' : '未达成';
  }
  const text = String(dimension.value ?? '').trim();
  return text || '暂无结果';
}

function buildPreviewDimension(
  templateDimension: AnalysisDimension,
  index: number
): AnalysisResult['dimensions'][string] {
  const base = {
    key: templateDimension.key,
    label: templateDimension.label,
    type: templateDimension.type
  } as const;

  switch (templateDimension.type) {
    case 'enum':
      return {
        ...base,
        value: templateDimension.options?.[0] || '推荐',
        rawText: '这里展示该模块的最新枚举判断结果'
      };
    case 'score':
      return {
        ...base,
        value: 78,
        rawText: '这里展示该模块的评分依据'
      };
    case 'list':
      return {
        ...base,
        value: ['要点一', '要点二', '要点三'],
        rawText: '这里展示该模块提取出的列表信息'
      };
    case 'tags':
      return {
        ...base,
        value: ['标签A', '标签B', '标签C'],
        rawText: '这里展示该模块识别出的标签'
      };
    case 'boolean':
      return {
        ...base,
        value: index % 2 === 0,
        rawText: '这里展示该模块是否满足条件'
      };
    case 'progress':
      return {
        ...base,
        value: '推进中',
        rawText: '这里展示当前阶段或推进状态'
      };
    case 'comparison':
      return {
        ...base,
        value: '较上次更积极',
        rawText: '这里展示该模块的对比变化'
      };
    case 'text':
    default:
      return {
        ...base,
        value: '这里展示该模块最新分析内容，用于预览多模块排版效果。',
        rawText: '这里会随着每次分析持续刷新'
      };
  }
}

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
  resetTranscriptWindow(sessionResp.data.session.transcript);
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
    resetTranscriptWindow(response.data.session.transcript);
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
    resetTranscriptWindow('');
    resetVoicePanelFeedback();
    stopElapsedTimer();
    await refreshSessions();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '结束会话失败';
  }
}

async function startRecordingCapture(): Promise<void> {
  if (!currentSession.value || audioRecorder.isRecording.value) return;
  error.value = '';
  liveCaptionTone.value = 'processing';
  liveCaptionText.value = '正在准备语音服务';

  try {
    await ensureAsrWorkerReady();
    await audioRecorder.connect();
    audioRecorder.resetSentOffset();
    resetTranscriptWindow();
    resetVoicePanelFeedback();
    liveCaptionText.value = '开始说话后会实时更新文字与分析';
    await audioRecorder.startRecording();
  } catch (err) {
    voiceLevel.value = 0;
    liveTranscriptSegment.value = '';
    liveCaptionTone.value = 'processing';
    liveCaptionText.value = '语音服务暂不可用';
    error.value = err instanceof Error ? err.message : '启动录音失败';
  }
}

async function pauseCurrentSession(): Promise<void> {
  if (!currentSession.value) return;
  error.value = '';

  try {
    audioRecorder.stopRecording();
    voiceLevel.value = 0;
    liveCaptionTone.value = 'processing';
    liveCaptionText.value = '录音已暂停';
    const response = await pauseInsightSession(currentSession.value.id);
    if (!response.success || !response.data) {
      throw new Error(response.error || '暂停会话失败');
    }

    currentSession.value = response.data.session;
    await refreshSessions();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '暂停会话失败';
  }
}

async function resumeCurrentSession(): Promise<void> {
  if (!currentSession.value) return;
  error.value = '';

  try {
    const response = await resumeInsightSession(currentSession.value.id);
    if (!response.success || !response.data) {
      throw new Error(response.error || '恢复会话失败');
    }

    currentSession.value = response.data.session;
    await startRecordingCapture();
    await refreshSessions();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '恢复会话失败';
  }
}

function toggleRecordingMute(): void {
  if (!canMuteRecording.value) return;

  if (audioRecorder.isMuted.value) {
    audioRecorder.unmute();
    liveCaptionTone.value = 'active';
    liveCaptionText.value = '';
    return;
  }

  audioRecorder.mute();
  voiceLevel.value = 0;
  liveCaptionTone.value = 'processing';
  liveCaptionText.value = '录音已静音';
}

async function selectSession(sessionId: string): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    audioRecorder.stopRecording();
    resetVoicePanelFeedback();
    resetTranscriptWindow();
    await loadSessionDetail(sessionId);
  } catch (err) {
    error.value = err instanceof Error ? err.message : '切换会话失败';
  } finally {
    loading.value = false;
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
                <span class="relative flex h-2.5 w-2.5" :class="{ 'animate-pulse': isRecording }">
                  <span
                    v-if="isRecording"
                    class="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/50" />
                  <span
                    class="relative inline-flex h-2.5 w-2.5 rounded-full"
                    :class="{
                      'bg-destructive': isRecording,
                      'bg-warning': isPaused,
                      'bg-muted-foreground/30': !isRecording && !isPaused
                    }" />
                </span>
                <span class="text-xs font-bold text-foreground/80">
                  {{ isRecording ? '采集中' : isPaused ? '已暂停' : '就绪' }}
                </span>
              </div>
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

        <div class="min-h-0 flex-1 overflow-hidden bg-background/94">
          <div class="flex h-full min-h-0">
            <section class="flex min-h-0 min-w-0 flex-1 flex-col pr-5">
              <div ref="transcriptPanelRef" class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div v-if="displayedTranscript" class="space-y-3">
                  <div class="px-1 text-[13px] leading-7 text-foreground/88">
                    {{ displayedTranscript }}
                  </div>
                </div>
                <div v-else class="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 px-1">
                  <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/6 text-primary/28">
                    <span class="i-carbon-microphone inline-block h-7 w-7" />
                  </div>
                  <div class="space-y-1 text-center">
                    <p class="text-sm font-medium text-muted-foreground/46">等待语音输入</p>
                    <p class="text-xs leading-6 text-muted-foreground/32"> 点击下方开始后，这里会实时展示语音内容 </p>
                  </div>
                </div>
              </div>
              <div
                v-if="hasSession"
                class="flex shrink-0 items-center justify-between border-t border-border/60 px-4 py-2.5">
                <div class="flex min-h-8 items-center gap-3">
                  <div class="inline-flex h-8 items-center gap-2">
                    <span
                      class="h-2 w-2 shrink-0 rounded-full"
                      :class="{
                        'bg-primary': isRecording && !audioRecorder.isMuted.value,
                        'bg-warning': isPaused || audioRecorder.isMuted.value,
                        'bg-muted-foreground/35': !isRecording && !isPaused
                      }" />
                    <span class="text-xs font-medium leading-none text-foreground/72">{{ transcriptStatusTitle }}</span>
                  </div>
                  <span
                    class="inline-flex h-8 items-center font-mono text-[11px] font-medium leading-none tabular-nums text-muted-foreground">
                    {{ elapsedTime }}
                  </span>
                  <div v-if="isRecording || isPaused" class="flex h-8 items-center gap-1" aria-hidden="true">
                    <span
                      v-for="(bar, index) in waveBars"
                      :key="index"
                      class="w-1 rounded-full bg-primary/70 transition-all duration-150"
                      :style="{ height: bar.height, opacity: bar.opacity, transitionDelay: bar.transitionDelay }" />
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 text-[11px] font-semibold text-foreground/78 transition-all hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                    :disabled="!canMuteRecording"
                    @click="toggleRecordingMute">
                    <span
                      class="inline-block h-4 w-4"
                      :class="audioRecorder.isMuted.value ? 'i-carbon-microphone-off' : 'i-carbon-volume-up'" />
                    {{ audioRecorder.isMuted.value ? '取消静音' : '静音' }}
                  </button>
                  <button
                    v-if="isPaused"
                    class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-success/25 bg-success/10 px-3 text-[11px] font-semibold text-success transition-all hover:bg-success/15 active:scale-95"
                    @click="resumeCurrentSession">
                    <span class="i-carbon-play inline-block h-4 w-4" />
                    开始
                  </button>
                  <button
                    v-else-if="!isRecording"
                    class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 text-[11px] font-semibold text-primary transition-all hover:bg-primary/15 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    @click="startRecordingCapture">
                    <span class="i-carbon-play inline-block h-4 w-4" />
                    开始
                  </button>
                  <button
                    v-else
                    class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-warning/25 bg-warning/10 px-3 text-[11px] font-semibold text-warning transition-all hover:bg-warning/15 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    @click="pauseCurrentSession">
                    <span class="i-carbon-pause inline-block h-4 w-4" />
                    暂停
                  </button>
                </div>
              </div>
            </section>

            <section class="flex h-full min-h-0 w-[360px] shrink-0 flex-col border-l border-border/60">
              <div class="min-h-0 flex-1">
                <div v-if="moduleItems.length" class="flex h-full min-h-0 flex-col gap-2">
                  <div
                    v-for="item in moduleItems"
                    :key="item.key"
                    class="min-h-0 overflow-hidden bg-background"
                    :class="expandedModuleKey === item.key ? 'flex-1' : 'shrink-0'">
                    <button
                      class="flex w-full items-center gap-3 border-b border-primary-foreground/12 bg-primary px-3 py-2.5 text-left text-primary-foreground transition-colors hover:bg-primary/95 active:bg-primary/92"
                      @click="toggleModule(item.key)">
                      <span
                        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/12 text-primary-foreground">
                        <span
                          v-if="item.templateDimension?.icon?.startsWith('i-carbon-')"
                          :class="item.templateDimension.icon"
                          class="inline-block h-4 w-4" />
                        <span v-else-if="item.templateDimension?.icon" class="text-base">
                          {{ item.templateDimension.icon }}
                        </span>
                        <span v-else class="i-carbon-chart-line-data inline-block h-4 w-4" />
                      </span>
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-semibold text-primary-foreground">
                          {{ item.dimension.label }}
                        </div>
                        <div class="mt-0.5 line-clamp-1 text-[11px] text-primary-foreground/70">
                          {{ getDimensionSummary(item.dimension) }}
                        </div>
                      </div>
                      <span
                        class="inline-block h-4 w-4 shrink-0 text-primary-foreground/80 transition-transform"
                        :class="expandedModuleKey === item.key ? 'i-carbon-chevron-down' : 'i-carbon-chevron-right'" />
                    </button>

                    <div
                      v-if="expandedModuleKey === item.key"
                      class="min-h-0 flex-1 overflow-y-auto border-t border-primary/10 bg-background px-2 py-2">
                      <DimensionRenderer
                        :dimension="item.dimension"
                        :change="changesMap.get(item.key)"
                        :icon="item.templateDimension?.icon"
                        :show-trend="item.templateDimension?.showTrend"
                        plain />
                    </div>
                  </div>
                </div>

                <div v-else class="flex h-full min-h-[280px] flex-col items-center justify-center gap-3">
                  <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/8 text-primary/35">
                    <span class="i-carbon-chart-line-data inline-block h-7 w-7" />
                  </div>
                  <p class="text-sm font-medium text-muted-foreground/40">等待首次分析</p>
                  <p class="text-xs text-muted-foreground/25">触发分析后，这里会按模块更新最新结果</p>
                </div>
              </div>
            </section>
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
