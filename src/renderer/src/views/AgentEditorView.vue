<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAgentsStore } from '@/stores/agents';
import type { AgentRuntimeType, CreateAgentParams } from '@/api/agents';
import ModelSelector from '@/components/ModelSelector.vue';
import MarkdownEditor from '@/components/MarkdownEditor.vue';
import { useMessageStore } from '@/components/Message';

const route = useRoute();
const router = useRouter();
const agentsStore = useAgentsStore();
const messageStore = useMessageStore();

const isEdit = computed(() => route.name === 'agent-edit');
const agentId = computed(() => route.params.id as string);

const currentStep = ref(1);
const totalSteps = 4;
const DEFAULT_RUNTIME_TYPE: AgentRuntimeType = 'pi-mono';
const agentRuntimeTypes = ['pi-mono', 'openai', 'claude'] as const satisfies readonly AgentRuntimeType[];
const stepItems = [
  { step: 1, label: '基本信息' },
  { step: 2, label: '数据目录' },
  { step: 3, label: '人格设置' },
  { step: 4, label: '技能设置' }
];

// 第1步：基本信息
const form = ref<CreateAgentParams>({
  id: '',
  name: '',
  description: '',
  instructions: '', // 暂时保留，但实际会从 SOUL.md 读取
  skills: [],
  model: '',
  runtimeType: DEFAULT_RUNTIME_TYPE,
  enableThinking: false,
  asrEnabled: false,
  ttsEnabled: false,
  metadata: {
    greeting: '',
    starterPrompts: []
  }
});

// 快捷问题管理
const starterPrompts = ref<string[]>([]);
const newPrompt = ref('');
const isPromptComposing = ref(false);
const starterPromptsLoaded = ref(false);
const starterPromptsSaving = ref(false);
const starterPromptsDirty = ref(false);
let starterPromptsSaveTimer: number | null = null;

const runtimeOptions: Array<{ value: AgentRuntimeType; label: string; description: string; icon: string }> = [
  { value: 'pi-mono', label: 'Pi Mono', description: '稳定默认', icon: 'i-carbon-application' },
  { value: 'openai', label: 'OpenAI', description: 'Agents Runtime', icon: 'i-carbon-machine-learning-model' },
  { value: 'claude', label: 'Claude', description: 'Claude SDK', icon: 'i-carbon-bot' }
];
const selectedRuntimeOption = computed(
  () => runtimeOptions.find((item) => item.value === form.value.runtimeType) || runtimeOptions[0]
);

function normalizeRuntimeType(value: unknown): AgentRuntimeType {
  return agentRuntimeTypes.includes(value as AgentRuntimeType) ? (value as AgentRuntimeType) : DEFAULT_RUNTIME_TYPE;
}

function normalizeStarterPrompts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.reduce<string[]>((prompts, item) => {
    if (typeof item !== 'string') return prompts;

    const prompt = item.trim();
    if (!prompt || seen.has(prompt)) return prompts;

    seen.add(prompt);
    prompts.push(prompt);
    return prompts;
  }, []);
}

function getMetadataString(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function omitDeprecatedMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const { dataDirectory: _dataDirectory, ...rest } = metadata || {};
  return rest;
}

function buildAgentMetadata(promptSnapshot: string[] = starterPrompts.value): Record<string, unknown> {
  const metadata = omitDeprecatedMetadata(form.value.metadata);
  return {
    ...metadata,
    greeting: getMetadataString(metadata, 'greeting'),
    starterPrompts: [...promptSnapshot]
  };
}

function syncStarterPromptsToMetadata(): void {
  form.value.metadata = buildAgentMetadata();
}

function setRuntimeType(value: AgentRuntimeType): void {
  form.value.runtimeType = value;
}

function clearStarterPromptsSaveTimer(): void {
  if (starterPromptsSaveTimer !== null) {
    window.clearTimeout(starterPromptsSaveTimer);
    starterPromptsSaveTimer = null;
  }
}

function scheduleStarterPromptsSave(): void {
  if (!isEdit.value || !agentId.value || !starterPromptsLoaded.value) return;

  clearStarterPromptsSaveTimer();
  starterPromptsSaveTimer = window.setTimeout(() => {
    void saveStarterPrompts();
  }, 300);
}

async function waitForStarterPromptsSave(): Promise<void> {
  while (starterPromptsSaving.value) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
}

async function saveStarterPrompts(): Promise<void> {
  if (!isEdit.value || !agentId.value || !starterPromptsLoaded.value) {
    return;
  }
  if (starterPromptsSaving.value) {
    scheduleStarterPromptsSave();
    return;
  }
  if (!starterPromptsDirty.value) {
    return;
  }

  // 拍快照，避免保存过程中 starterPrompts 被修改
  const snapshot = [...starterPrompts.value];
  const metadataToSave = buildAgentMetadata(snapshot);

  starterPromptsSaving.value = true;
  try {
    const success = await agentsStore.modifyAgent(agentId.value, {
      metadata: metadataToSave
    });

    if (success) {
      // 检查是否在保存期间又有新的修改
      starterPromptsDirty.value = JSON.stringify(starterPrompts.value) !== JSON.stringify(snapshot);
      form.value.metadata = starterPromptsDirty.value ? buildAgentMetadata() : metadataToSave;
    } else {
      console.warn('[AgentEditorView] Auto save starterPrompts failed:', agentsStore.error);
      starterPromptsDirty.value = true; // 保存失败，标记为脏数据
    }
  } finally {
    starterPromptsSaving.value = false;
    if (starterPromptsDirty.value) {
      scheduleStarterPromptsSave();
    }
  }
}

function commitStarterPrompt(shouldAutoSave: boolean): boolean {
  const prompt = newPrompt.value.trim();
  if (!prompt) return false;

  if (starterPrompts.value.includes(prompt)) {
    messageStore.warning('这个快捷问题已经添加过了');
    return false;
  }

  starterPrompts.value = [...starterPrompts.value, prompt];
  syncStarterPromptsToMetadata();
  starterPromptsDirty.value = true;
  newPrompt.value = '';

  if (shouldAutoSave) {
    scheduleStarterPromptsSave();
  }

  return true;
}

const addStarterPrompt = (): void => {
  commitStarterPrompt(true);
};

function handleStarterPromptEnter(event: KeyboardEvent): void {
  if (event.isComposing || isPromptComposing.value) return;

  event.preventDefault();
  commitStarterPrompt(true);
}

const removeStarterPrompt = (index: number): void => {
  starterPrompts.value.splice(index, 1);
  syncStarterPromptsToMetadata();
  starterPromptsDirty.value = true;
  scheduleStarterPromptsSave();
};

// 第2步：人格文件
type PersonalityFile = 'IDENTITY.md' | 'SOUL.md' | 'USER.md' | 'NOTES.md' | 'HEARTBEAT.md' | 'AGENTS.md';

interface PersonalityTab {
  key: PersonalityFile;
  label: string;
  description: string;
  placeholder: string;
}

const personalityTabs: PersonalityTab[] = [
  {
    key: 'IDENTITY.md',
    label: 'IDENTITY.md',
    description: '身份名片：名字、风格、签名 emoji',
    placeholder: 'Name: 我的名字\nVibe: 我的风格（如温和、严肃、活泼）\nEmoji: 我的签名 emoji'
  },
  {
    key: 'SOUL.md',
    label: 'SOUL.md',
    description: '核心灵魂：行为原则、风格定调',
    placeholder: '# 核心原则\n1. 我的第一个原则...\n2. 我的第二个原则...\n\n# 行为风格\n...'
  },
  {
    key: 'USER.md',
    label: 'USER.md',
    description: '主人档案：用户称呼、偏好、使用场景',
    placeholder: '称呼: 用户的称呼\n主要用途: 使用场景\n偏好: 用户偏好'
  },
  {
    key: 'NOTES.md',
    label: 'NOTES.md',
    description: '环境备注：特殊配置、常用路径',
    placeholder: '记录环境相关的特殊配置...'
  },
  {
    key: 'HEARTBEAT.md',
    label: 'HEARTBEAT.md',
    description: '心跳任务：定期需要检查和执行的任务',
    placeholder: '- 任务1\n- 任务2\n- ...'
  },
  {
    key: 'AGENTS.md',
    label: 'AGENTS.md',
    description: 'Agent 规则与技能配置',
    placeholder:
      '# Agent Rules\n\n<!-- Agent 级规则 -->\n\n\n<skills_system priority="1">\n## Available Skills\n\n<available_skills>\n<!-- 技能配置 -->\n</available_skills>\n\n</skills_system>'
  }
];

const currentPersonalityTab = ref<PersonalityFile>('IDENTITY.md');
const personalityFiles = ref<Record<PersonalityFile, string>>({
  'IDENTITY.md': '',
  'SOUL.md': '',
  'USER.md': '',
  'NOTES.md': '',
  'HEARTBEAT.md': '',
  'AGENTS.md': ''
});

// 第4步：技能选择
const newSkillId = ref('');

function normalizeSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.reduce<string[]>((skills, item) => {
    if (typeof item !== 'string') return skills;

    const skill = item.trim();
    if (!skill || seen.has(skill)) return skills;

    seen.add(skill);
    skills.push(skill);
    return skills;
  }, []);
}

function parseSkillInput(value: string): string[] {
  return value
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const configuredSkills = computed(() => normalizeSkillIds(form.value.skills));

function setSkills(skills: string[]): void {
  form.value.skills = normalizeSkillIds(skills);
}

function addSkill(): void {
  const incomingSkills = parseSkillInput(newSkillId.value);
  if (incomingSkills.length === 0) return;

  const currentSkills = normalizeSkillIds(form.value.skills);
  const nextSkills = normalizeSkillIds([...currentSkills, ...incomingSkills]);

  if (nextSkills.length === currentSkills.length) {
    messageStore.warning('这些技能已经添加过了');
    return;
  }

  setSkills(nextSkills);
  newSkillId.value = '';
}

function handleSkillEnter(event: KeyboardEvent): void {
  if (event.isComposing) return;

  event.preventDefault();
  addSkill();
}

function removeSkill(skillId: string): void {
  setSkills(configuredSkills.value.filter((id) => id !== skillId));
}

// 自动生成 ID (仅在创建模式下，且用户没有手动修改过 ID 时)
const idManuallyEdited = ref(false);
watch(
  () => form.value.name,
  (newName) => {
    if (!isEdit.value && !idManuallyEdited.value) {
      if (!newName) {
        form.value.id = '';
      } else {
        const slug = newName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
        if (slug.length > 0) {
          form.value.id = `${slug}-${Math.floor(Math.random() * 1000)}`;
        } else {
          form.value.id = `agent-${Date.now().toString(36)}`;
        }
      }
    }
  }
);

const handleIdInput = (): void => {
  idManuallyEdited.value = true;
};

onMounted(async () => {
  if (isEdit.value && agentId.value) {
    // 编辑模式：加载现有数据
    if (agentsStore.agents.length === 0) {
      await agentsStore.fetchAgents();
    }
    const agent = agentsStore.agents.find((a) => a.id === agentId.value);
    if (agent) {
      // 获取基本信息
      const res = await agentsStore.getAgentDetail(agent.id);
      if (res) {
        const loadedStarterPrompts = normalizeStarterPrompts(res.metadata?.starterPrompts);
        form.value = {
          id: res.id,
          name: res.name,
          description: res.description,
          instructions: res.instructions || '',
          skills: normalizeSkillIds(res.skills),
          model: res.model || '',
          runtimeType: normalizeRuntimeType(res.runtimeType),
          enableThinking: res.enableThinking ?? false,
          asrEnabled: res.asrEnabled ?? false,
          ttsEnabled: res.ttsEnabled ?? false,
          metadata: {
            ...omitDeprecatedMetadata(res.metadata),
            greeting: getMetadataString(res.metadata, 'greeting'),
            starterPrompts: loadedStarterPrompts
          }
        };

        // 初始化快捷问题列表
        starterPrompts.value = loadedStarterPrompts;
        syncStarterPromptsToMetadata();
        starterPromptsDirty.value = false;
        starterPromptsLoaded.value = true;
      } else {
        form.value = {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          instructions: '',
          skills: normalizeSkillIds(agent.skills),
          model: agent.model || '',
          runtimeType: normalizeRuntimeType(agent.runtimeType),
          enableThinking: agent.enableThinking ?? false,
          asrEnabled: agent.asrEnabled ?? false,
          ttsEnabled: agent.ttsEnabled ?? false,
          metadata: { greeting: '', starterPrompts: [] }
        };
        starterPrompts.value = [];
        starterPromptsDirty.value = false;
        starterPromptsLoaded.value = true;
      }

      // 加载人格文件
      try {
        const files = await agentsStore.getPersonalityFiles(agent.id);
        if (files) {
          personalityFiles.value = {
            'IDENTITY.md': files['IDENTITY.md'] || '',
            'SOUL.md': files['SOUL.md'] || '',
            'USER.md': files['USER.md'] || '',
            'NOTES.md': files['NOTES.md'] || '',
            'HEARTBEAT.md': files['HEARTBEAT.md'] || '',
            'AGENTS.md': files['AGENTS.md'] || ''
          };
        }
      } catch (err) {
        console.error('[AgentEditorView] Failed to load personality files:', err);
      }
    } else {
      messageStore.error('找不到该智能体');
      router.push('/agents');
    }
  }
});

const nextStep = (): void => {
  if (currentStep.value === 1) {
    if (!form.value.name) {
      messageStore.error('请输入智能体名称');
      return;
    }
    if (!form.value.id) {
      messageStore.error('请输入或生成智能体 ID');
      return;
    }
    if (!form.value.description) {
      messageStore.error('请输入智能体描述');
      return;
    }
  }

  if (currentStep.value < totalSteps) {
    currentStep.value++;
  }
};

const prevStep = (): void => {
  if (currentStep.value > 1) {
    currentStep.value--;
  }
};

function goToStep(step: number): void {
  currentStep.value = Math.min(Math.max(step, 1), totalSteps);
}

const submitting = ref(false);

const handleSubmit = async (): Promise<void> => {
  if (submitting.value) return;
  clearStarterPromptsSaveTimer();

  // 最终提交前的完整校验
  if (!form.value.name) {
    messageStore.error('请输入智能体名称');
    currentStep.value = 1;
    return;
  }
  if (!form.value.id) {
    messageStore.error('请输入或生成智能体 ID');
    currentStep.value = 1;
    return;
  }
  if (!form.value.description) {
    messageStore.error('请输入智能体描述');
    currentStep.value = 1;
    return;
  }

  submitting.value = true;
  try {
    commitStarterPrompt(false);
    await waitForStarterPromptsSave();
    clearStarterPromptsSaveTimer();

    form.value.runtimeType = normalizeRuntimeType(form.value.runtimeType);
    form.value.skills = normalizeSkillIds(form.value.skills);
    const metadata = buildAgentMetadata();

    console.log('[AgentEditorView] Submitting agent:', {
      id: form.value.id,
      name: form.value.name,
      description: form.value.description,
      personalityFiles: Object.keys(personalityFiles.value).reduce(
        (acc, key) => {
          acc[key] = personalityFiles.value[key as PersonalityFile].length;
          return acc;
        },
        {} as Record<string, number>
      ),
      skills: form.value.skills,
      model: form.value.model,
      runtimeType: form.value.runtimeType,
      enableThinking: form.value.enableThinking,
      asrEnabled: form.value.asrEnabled,
      ttsEnabled: form.value.ttsEnabled
    });

    let success = false;
    if (isEdit.value) {
      // 编辑模式
      success = await agentsStore.modifyAgent(agentId.value, {
        name: form.value.name,
        description: form.value.description,
        instructions: personalityFiles.value['SOUL.md'] || '你是一个智能助手。', // 使用 SOUL.md 作为 instructions，如果为空则使用默认值
        skills: form.value.skills,
        model: form.value.model,
        runtimeType: form.value.runtimeType,
        enableThinking: form.value.enableThinking,
        asrEnabled: form.value.asrEnabled,
        ttsEnabled: form.value.ttsEnabled,
        metadata
      });

      // 更新人格文件
      if (success) {
        for (const file of personalityTabs) {
          await agentsStore.updatePersonalityFile(agentId.value, file.key, personalityFiles.value[file.key]);
        }
      }
    } else {
      // 创建模式
      success = await agentsStore.createNewAgent({
        ...form.value,
        instructions: personalityFiles.value['SOUL.md'] || '你是一个智能助手。', // 使用 SOUL.md 作为 instructions，如果为空则使用默认值
        metadata
      });

      // 创建后更新人格文件
      if (success) {
        for (const file of personalityTabs) {
          await agentsStore.updatePersonalityFile(form.value.id, file.key, personalityFiles.value[file.key]);
        }
      }
    }

    console.log('[AgentEditorView] Submit result:', { success, error: agentsStore.error });

    if (success) {
      messageStore.success(isEdit.value ? '保存成功' : '创建成功');
      router.push('/agents');
    } else {
      messageStore.error(agentsStore.error || '操作失败');
    }
  } catch (err) {
    console.error('[AgentEditorView] Submit error:', err);
    messageStore.error(err instanceof Error ? err.message : String(err));
  } finally {
    submitting.value = false;
  }
};

const handleCancel = (): void => {
  clearStarterPromptsSaveTimer();
  router.push('/agents');
};

onUnmounted(() => {
  clearStarterPromptsSaveTimer();
});
</script>

<template>
  <div class="agent-editor-view flex h-full flex-col bg-background text-foreground">
    <!-- 顶栏 -->
    <header
      class="flex h-14 shrink-0 items-center justify-between border-b border-border/40 bg-surface/60 px-6 backdrop-blur">
      <div class="flex items-center gap-3">
        <button
          class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="handleCancel">
          <span class="i-carbon-arrow-left text-lg"></span>
        </button>
        <h1 class="text-base font-semibold tracking-tight">
          {{ isEdit ? '编辑智能体' : '自定义智能体' }}
        </h1>
      </div>

      <!-- 步骤指示器 -->
      <div class="flex items-center gap-2 overflow-x-auto text-sm font-medium">
        <template v-for="item in stepItems" :key="item.step">
          <button
            type="button"
            class="flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted/60"
            :class="currentStep >= item.step ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
            :aria-current="currentStep === item.step ? 'step' : undefined"
            @click="goToStep(item.step)">
            <span
              class="flex h-6 w-6 items-center justify-center rounded-full text-xs"
              :class="
                currentStep >= item.step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              ">
              {{ item.step }}
            </span>
            <span>{{ item.label }}</span>
          </button>
          <div v-if="item.step < totalSteps" class="h-px w-8 shrink-0 bg-border"></div>
        </template>
      </div>
    </header>

    <!-- 内容区 -->
    <div class="flex-1 overflow-y-auto p-8">
      <div class="mx-auto max-w-5xl">
        <!-- Step 1: 基本信息 -->
        <div v-show="currentStep === 1" class="space-y-6">
          <div class="space-y-1 selectable">
            <h2 class="text-xl font-semibold tracking-tight">基本信息</h2>
            <p class="text-sm text-muted-foreground">定义智能体的名称、标识和使用的模型。</p>
          </div>

          <div class="space-y-4 rounded-xl border border-border/40 bg-card p-6 shadow-sm selectable">
            <div class="space-y-2">
              <label class="text-sm font-medium">名称 <span class="text-red-500">*</span></label>
              <input
                v-model="form.name"
                type="text"
                placeholder="例如：前端开发专家"
                class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium">唯一标识 (ID) <span class="text-red-500">*</span></label>
              <input
                v-model="form.id"
                type="text"
                :disabled="isEdit"
                placeholder="例如：frontend-expert"
                class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                @input="handleIdInput" />
              <p class="text-xs text-muted-foreground">将作为智能体的唯一 ID，创建后不可修改。</p>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium">描述 <span class="text-red-500">*</span></label>
              <textarea
                v-model="form.description"
                v-ai-polish="{ label: '描述', placeholder: '简短描述该智能体的用途', context: '智能体编辑：描述字段' }"
                rows="3"
                placeholder="简短描述该智能体的用途…输入后长按 Ctrl 可 AI 润色"
                class="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"></textarea>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium">默认模型</label>
              <ModelSelector v-model="form.model" />
              <p class="text-xs text-muted-foreground">留空则使用系统默认模型。</p>
            </div>

            <div class="space-y-3 border-t border-border/40 pt-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <label class="text-sm font-medium">默认运行配置</label>
                  <p class="mt-1 text-xs text-muted-foreground">新会话默认继承这里的设置，会话内可单独覆盖。</p>
                </div>
                <span
                  class="shrink-0 rounded-md border border-primary/25 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                  当前 {{ selectedRuntimeOption.label }}
                </span>
              </div>

              <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                <div class="grid gap-2 sm:grid-cols-3">
                  <button
                    v-for="item in runtimeOptions"
                    :key="item.value"
                    type="button"
                    :aria-pressed="form.runtimeType === item.value"
                    class="flex h-14 min-w-0 items-center rounded-lg border px-3 text-left transition-colors"
                    :class="
                      form.runtimeType === item.value
                        ? 'border-primary/50 bg-primary/10 text-primary shadow-sm ring-1 ring-primary/15'
                        : 'border-border/45 bg-background text-muted-foreground hover:border-border hover:bg-muted/35 hover:text-foreground'
                    "
                    @click="setRuntimeType(item.value)">
                    <span :class="[item.icon, 'h-4 w-4 shrink-0']"></span>
                    <span class="ml-2 min-w-0 flex-1">
                      <span class="block truncate text-xs font-semibold">{{ item.label }}</span>
                      <span class="mt-0.5 block truncate text-[10px] opacity-75">{{ item.description }}</span>
                    </span>
                    <span
                      v-if="form.runtimeType === item.value"
                      class="i-carbon-checkmark-filled ml-2 h-3.5 w-3.5 shrink-0"></span>
                  </button>
                </div>

                <div class="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    class="flex h-12 items-center justify-between gap-3 rounded-lg border px-3 text-left transition-colors"
                    :class="
                      form.enableThinking
                        ? 'border-primary/35 bg-primary/10 text-primary'
                        : 'border-border/45 bg-background text-muted-foreground hover:bg-muted/35 hover:text-foreground'
                    "
                    @click="form.enableThinking = !form.enableThinking">
                    <span class="flex min-w-0 items-center gap-2">
                      <span class="i-carbon-phrase-sentiment h-3.5 w-3.5 shrink-0"></span>
                      <span class="truncate text-xs font-medium">思维链</span>
                    </span>
                    <span v-if="form.enableThinking" class="i-carbon-checkmark-filled h-3.5 w-3.5 shrink-0"></span>
                  </button>

                  <button
                    type="button"
                    class="flex h-12 items-center justify-between gap-3 rounded-lg border px-3 text-left transition-colors"
                    :class="
                      form.asrEnabled
                        ? 'border-primary/35 bg-primary/10 text-primary'
                        : 'border-border/45 bg-background text-muted-foreground hover:bg-muted/35 hover:text-foreground'
                    "
                    @click="form.asrEnabled = !form.asrEnabled">
                    <span class="flex min-w-0 items-center gap-2">
                      <span class="i-carbon-microphone h-3.5 w-3.5 shrink-0"></span>
                      <span class="truncate text-xs font-medium">ASR</span>
                    </span>
                    <span v-if="form.asrEnabled" class="i-carbon-checkmark-filled h-3.5 w-3.5 shrink-0"></span>
                  </button>

                  <button
                    type="button"
                    class="flex h-12 items-center justify-between gap-3 rounded-lg border px-3 text-left transition-colors"
                    :class="
                      form.ttsEnabled
                        ? 'border-primary/35 bg-primary/10 text-primary'
                        : 'border-border/45 bg-background text-muted-foreground hover:bg-muted/35 hover:text-foreground'
                    "
                    @click="form.ttsEnabled = !form.ttsEnabled">
                    <span class="flex min-w-0 items-center gap-2">
                      <span class="i-carbon-volume-up h-3.5 w-3.5 shrink-0"></span>
                      <span class="truncate text-xs font-medium">TTS</span>
                    </span>
                    <span v-if="form.ttsEnabled" class="i-carbon-checkmark-filled h-3.5 w-3.5 shrink-0"></span>
                  </button>
                </div>
              </div>
            </div>

            <div class="border-t border-border/40 pt-4 mt-2"></div>

            <div class="space-y-2">
              <label class="text-sm font-medium">开场白 (Greeting)</label>
              <textarea
                v-if="form.metadata"
                rows="2"
                placeholder="例如：你好！我是你的专属助手，今天想聊点什么？"
                class="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                :value="(form.metadata.greeting as string) || ''"
                @input="
                  (e) => {
                    if (form.metadata) form.metadata.greeting = (e.target as HTMLTextAreaElement).value;
                  }
                "></textarea>
              <p class="text-xs text-muted-foreground">智能体在新对话开始时发送的第一句话。</p>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium">快捷问题 (Starter Prompts)</label>

              <!-- 已添加的问题列表 -->
              <div v-if="starterPrompts.length > 0" class="flex flex-col gap-2 mb-3">
                <div
                  v-for="(prompt, index) in starterPrompts"
                  :key="`${index}-${prompt}`"
                  class="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  <span class="flex-1 truncate">{{ prompt }}</span>
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    title="移除"
                    @click="removeStarterPrompt(index)">
                    <span class="i-carbon-close"></span>
                  </button>
                </div>
              </div>

              <!-- 添加新问题输入框 -->
              <div class="flex gap-2">
                <input
                  v-model="newPrompt"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="输入快捷问题，按回车添加..."
                  class="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  @compositionstart="isPromptComposing = true"
                  @compositionend="isPromptComposing = false"
                  @keydown.enter="handleStarterPromptEnter" />
                <button
                  type="button"
                  :disabled="!newPrompt.trim()"
                  class="shrink-0 rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="addStarterPrompt">
                  添加
                </button>
              </div>
              <p class="text-xs text-muted-foreground">提供给用户的快捷提问选项，帮助用户快速开始对话。</p>
            </div>
          </div>
        </div>

        <!-- Step 2: 数据目录配置 -->
        <div v-show="currentStep === 2" class="space-y-6">
          <div class="space-y-1 selectable">
            <h2 class="text-xl font-semibold tracking-tight">数据目录配置</h2>
            <p class="text-sm text-muted-foreground">为智能体指定固定的数据存储位置</p>
          </div>

          <div class="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 space-y-4 selectable">
            <!-- 重要性说明 -->
            <div class="flex items-start gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <span class="i-carbon-information text-xl"></span>
              </div>
              <div class="flex-1 space-y-2">
                <h3 class="text-base font-semibold text-foreground">为什么需要数据目录？</h3>
                <div class="text-sm text-foreground/85 leading-relaxed space-y-2">
                  <p>
                    数据目录是智能体的<strong class="text-primary">固定工作区</strong
                    >，用于存储所有任务产生的文件和中间结果。
                  </p>
                  <p class="flex items-start gap-2">
                    <span class="i-carbon-checkmark-filled text-primary shrink-0 mt-0.5"></span>
                    <span><strong>持久化存储</strong>：所有任务生成的文件都保存在这里，不会丢失</span>
                  </p>
                  <p class="flex items-start gap-2">
                    <span class="i-carbon-checkmark-filled text-primary shrink-0 mt-0.5"></span>
                    <span><strong>跨任务访问</strong>：下次开启新任务时，智能体能自动找到之前的数据</span>
                  </p>
                  <p class="flex items-start gap-2">
                    <span class="i-carbon-checkmark-filled text-primary shrink-0 mt-0.5"></span>
                    <span><strong>数据组织</strong>：按智能体分类存储，便于管理和查找</span>
                  </p>
                  <p class="flex items-start gap-2 mt-3 pt-2 border-t border-primary/20">
                    <span class="i-carbon-idea text-primary shrink-0 mt-0.5"></span>
                    <span
                      >系统会自动把业务工作区固定在智能体目录内（<code
                        class="text-xs px-1 py-0.5 rounded bg-background/60"
                        >agents/{'{agentId}'}/workspace</code
                      >），会话产物固定写入
                      <code class="text-xs px-1 py-0.5 rounded bg-background/60"
                        >agents/{'{agentId}'}/sessions</code
                      ></span
                    >
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- 数据目录说明 -->
          <div class="rounded-xl border border-border/40 bg-card p-6 shadow-sm space-y-4 selectable">
            <div class="space-y-2">
              <label class="text-sm font-medium flex items-center gap-2">
                <span class="i-carbon-folder-details text-primary"></span>
                业务工作区
                <span class="text-xs font-normal text-muted-foreground">（系统固定维护）</span>
              </label>
              <p class="text-sm text-muted-foreground">
                工具执行、脚本输出、索引和报告都会写入智能体目录下的
                <code class="text-xs px-1 py-0.5 rounded bg-background/60">workspace</code
                >，不再支持在智能体配置中自定义
                <code class="text-xs px-1 py-0.5 rounded bg-background/60">dataDirectory</code>。
              </p>
            </div>
          </div>
        </div>

        <!-- Step 3: 人格设置 -->
        <div v-show="currentStep === 3" class="space-y-6">
          <div class="space-y-1 selectable">
            <h2 class="text-xl font-semibold tracking-tight">人格设置</h2>
            <p class="text-sm text-muted-foreground">通过人格文件定义智能体的身份、核心灵魂和行为准则。</p>
          </div>

          <!-- Tab Navigation -->
          <div class="flex gap-1 overflow-x-auto border-b border-border pb-px">
            <button
              v-for="tab in personalityTabs"
              :key="tab.key"
              class="relative shrink-0 whitespace-nowrap px-2.5 py-2 text-[11px] font-medium transition-colors sm:px-3 sm:text-xs"
              :class="
                currentPersonalityTab === tab.key ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              "
              :title="tab.label"
              @click="currentPersonalityTab = tab.key">
              {{ tab.label.replace('.md', '') }}
              <div
                v-if="currentPersonalityTab === tab.key"
                class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"></div>
            </button>
          </div>

          <!-- Tab Content -->
          <div class="rounded-xl border border-border/40 bg-card p-6 shadow-sm selectable">
            <div class="space-y-3">
              <div class="flex items-start justify-between">
                <div>
                  <h3 class="text-base font-medium">{{
                    personalityTabs.find((t) => t.key === currentPersonalityTab)?.label
                  }}</h3>
                  <p class="text-sm text-muted-foreground mt-1">{{
                    personalityTabs.find((t) => t.key === currentPersonalityTab)?.description
                  }}</p>
                </div>
              </div>
              <MarkdownEditor
                :key="currentPersonalityTab"
                v-model="personalityFiles[currentPersonalityTab]"
                :placeholder="personalityTabs.find((t) => t.key === currentPersonalityTab)?.placeholder || ''"
                min-height="300px" />
            </div>
          </div>
        </div>

        <!-- Step 4: 技能设置 -->
        <div v-show="currentStep === 4" class="space-y-6">
          <div class="space-y-1 selectable">
            <h2 class="text-xl font-semibold tracking-tight">技能设置</h2>
            <p class="text-sm text-muted-foreground">管理当前智能体已配置的技能。</p>
          </div>

          <div class="rounded-xl border border-border/40 bg-card p-6 shadow-sm selectable">
            <div class="flex flex-wrap items-start justify-between gap-3 border-b border-border/40 pb-4">
              <div class="space-y-1">
                <h3 class="text-sm font-semibold text-foreground">已配置技能</h3>
                <p class="text-xs text-muted-foreground">当前智能体会加载这里列出的全部技能。</p>
              </div>
              <span
                class="rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {{ configuredSkills.length }} 个技能
              </span>
            </div>

            <div class="mt-4 flex gap-2">
              <input
                v-model="newSkillId"
                type="text"
                placeholder="添加技能 ID"
                class="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                @keydown.enter="handleSkillEnter" />
              <button
                type="button"
                :disabled="!newSkillId.trim()"
                class="shrink-0 rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
                @click="addSkill">
                添加
              </button>
            </div>

            <div v-if="configuredSkills.length === 0" class="mt-6 rounded-lg border border-dashed border-border p-8">
              <div class="flex flex-col items-center text-center text-muted-foreground">
                <span class="i-carbon-cube h-8 w-8 opacity-40"></span>
                <p class="mt-3 text-sm">当前没有配置技能</p>
              </div>
            </div>

            <div v-else class="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <div
                v-for="skill in configuredSkills"
                :key="skill"
                class="group flex min-w-0 items-center gap-3 rounded-lg border border-border/55 bg-background px-3 py-2 transition-colors hover:border-primary/30 hover:bg-primary/5">
                <span class="i-carbon-cube h-4 w-4 shrink-0 text-primary/70"></span>
                <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground" :title="skill">
                  {{ skill }}
                </span>
                <button
                  type="button"
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-80 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  title="移除技能"
                  @click="removeSkill(skill)">
                  <span class="i-carbon-close h-3.5 w-3.5"></span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <footer
      class="flex h-16 shrink-0 items-center justify-between border-t border-border/40 bg-surface/60 px-8 backdrop-blur">
      <button
        class="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="handleCancel">
        取消
      </button>

      <div class="flex items-center gap-3">
        <button
          v-if="currentStep > 1"
          class="rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
          @click="prevStep">
          上一步
        </button>

        <button
          v-if="currentStep < totalSteps"
          class="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          @click="nextStep">
          下一步
        </button>

        <button
          v-if="currentStep === totalSteps"
          class="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="submitting"
          @click="handleSubmit">
          <span v-if="submitting" class="i-carbon-progress-bar animate-spin"></span>
          {{ isEdit ? '保存修改' : '完成创建' }}
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* 动画可以根据需要添加 */
</style>
