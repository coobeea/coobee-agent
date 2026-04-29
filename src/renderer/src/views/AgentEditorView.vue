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

// 第1步：基本信息
const form = ref<CreateAgentParams>({
  id: '',
  name: '',
  description: '',
  instructions: '', // 暂时保留，但实际会从 SOUL.md 读取
  skills: [],
  model: '',
  runtimeType: 'pi-mono',
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
const starterPromptsLoaded = ref(false);
const starterPromptsSaving = ref(false);
const starterPromptsDirty = ref(false);
let starterPromptsSaveTimer: number | null = null;

const runtimeOptions: Array<{ value: AgentRuntimeType; label: string; description: string }> = [
  { value: 'pi-mono', label: 'Pi', description: '默认 Agent Runtime' },
  { value: 'openai', label: 'OpenAI', description: 'OpenAI Agents Runtime' },
  { value: 'claude', label: 'Claude', description: 'Claude Runtime' }
];

function syncStarterPromptsToMetadata(): void {
  form.value.metadata = {
    ...(form.value.metadata || {}),
    greeting: form.value.metadata?.greeting || '',
    starterPrompts: [...starterPrompts.value]
  };
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

async function saveStarterPrompts(): Promise<void> {
  console.log('[AgentEditorView] saveStarterPrompts called:', {
    isEdit: isEdit.value,
    agentId: agentId.value,
    starterPromptsLoaded: starterPromptsLoaded.value,
    starterPromptsSaving: starterPromptsSaving.value,
    starterPromptsDirty: starterPromptsDirty.value,
    promptsCount: starterPrompts.value.length,
    allPrompts: [...starterPrompts.value]
  });

  if (!isEdit.value || !agentId.value || !starterPromptsLoaded.value) {
    console.warn('[AgentEditorView] Save skipped: conditions not met');
    return;
  }
  if (starterPromptsSaving.value) {
    console.log('[AgentEditorView] Already saving, rescheduling...');
    scheduleStarterPromptsSave();
    return;
  }
  if (!starterPromptsDirty.value) {
    console.log('[AgentEditorView] No changes to save');
    return;
  }

  // 拍快照，避免保存过程中 starterPrompts 被修改
  const snapshot = [...starterPrompts.value];
  const currentGreeting = form.value.metadata?.greeting || '';

  console.log('[AgentEditorView] Saving starterPrompts:', {
    snapshot,
    greeting: currentGreeting,
    fullMetadata: { greeting: currentGreeting, starterPrompts: snapshot }
  });

  starterPromptsSaving.value = true;
  try {
    // 构造完整的 metadata 对象（基于快照，不依赖 form.value.metadata 当前状态）
    const metadataToSave = {
      greeting: currentGreeting,
      starterPrompts: snapshot
    };

    const success = await agentsStore.modifyAgent(agentId.value, {
      metadata: metadataToSave
    });

    console.log('[AgentEditorView] Save result:', {
      success,
      error: agentsStore.error,
      sentData: metadataToSave
    });

    if (success) {
      // 保存成功后，同步到 form.value.metadata
      syncStarterPromptsToMetadata();
      // 检查是否在保存期间又有新的修改
      starterPromptsDirty.value = JSON.stringify(starterPrompts.value) !== JSON.stringify(snapshot);
    } else {
      console.warn('[AgentEditorView] Auto save starterPrompts failed:', agentsStore.error);
      starterPromptsDirty.value = true; // 保存失败，标记为脏数据
    }
  } finally {
    starterPromptsSaving.value = false;
    if (starterPromptsDirty.value) {
      console.log('[AgentEditorView] Still dirty after save, rescheduling...');
      scheduleStarterPromptsSave();
    } else {
      console.log('[AgentEditorView] Save completed successfully');
    }
  }
}

const addStarterPrompt = (): void => {
  const prompt = newPrompt.value.trim();
  if (prompt && !starterPrompts.value.includes(prompt)) {
    starterPrompts.value.push(prompt);
    syncStarterPromptsToMetadata();
    starterPromptsDirty.value = true;
    console.log('[AgentEditorView] Added starter prompt:', {
      prompt,
      totalPrompts: starterPrompts.value.length,
      allPrompts: [...starterPrompts.value],
      isEdit: isEdit.value,
      agentId: agentId.value,
      starterPromptsLoaded: starterPromptsLoaded.value
    });
    scheduleStarterPromptsSave();
    newPrompt.value = '';
  }
};

const removeStarterPrompt = (index: number): void => {
  starterPrompts.value.splice(index, 1);
  syncStarterPromptsToMetadata();
  starterPromptsDirty.value = true;
  scheduleStarterPromptsSave();
};

// 选择数据目录
async function selectDataDirectory(): Promise<void> {
  try {
    const result = await window.api?.openDirectory();
    if (result && form.value.metadata) {
      form.value.metadata.dataDirectory = result;
    }
  } catch (err) {
    console.error('[AgentEditorView] selectDataDirectory error:', err);
  }
}

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
const availableSkills = [
  { id: 'web-search', name: '网络搜索', description: '允许智能体搜索互联网获取最新信息', icon: 'i-carbon-search' },
  { id: 'file-system', name: '文件系统', description: '允许智能体读取和写入本地文件', icon: 'i-carbon-document' },
  { id: 'code-execution', name: '代码执行', description: '允许智能体在沙箱中执行代码', icon: 'i-carbon-code' },
  { id: 'terminal', name: '终端访问', description: '允许智能体执行命令行指令', icon: 'i-carbon-terminal' }
];

const toggleSkill = (skillId: string): void => {
  const skills = form.value.skills || [];
  const index = skills.indexOf(skillId);
  if (index > -1) {
    form.value.skills = skills.filter((id) => id !== skillId);
  } else {
    form.value.skills = [...skills, skillId];
  }
};

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
        form.value = {
          id: res.id,
          name: res.name,
          description: res.description,
          instructions: res.instructions || '',
          skills: res.skills || [],
          model: res.model || '',
          runtimeType: res.runtimeType || 'pi-mono',
          enableThinking: res.enableThinking ?? false,
          asrEnabled: res.asrEnabled ?? false,
          ttsEnabled: res.ttsEnabled ?? false,
          metadata: {
            greeting: (res.metadata?.greeting as string) || '',
            starterPrompts: Array.isArray(res.metadata?.starterPrompts) ? res.metadata.starterPrompts : [],
            dataDirectory: (res.metadata?.dataDirectory as string) || ''
          }
        };

        // 初始化快捷问题列表
        if (res.metadata && Array.isArray(res.metadata.starterPrompts)) {
          starterPrompts.value = [...res.metadata.starterPrompts];
        } else {
          starterPrompts.value = [];
        }
        syncStarterPromptsToMetadata();
        starterPromptsDirty.value = false;
        starterPromptsLoaded.value = true;
      } else {
        form.value = {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          instructions: '',
          skills: agent.skills || [],
          model: agent.model || '',
          runtimeType: agent.runtimeType || 'pi-mono',
          enableThinking: agent.enableThinking ?? false,
          asrEnabled: agent.asrEnabled ?? false,
          ttsEnabled: agent.ttsEnabled ?? false,
          metadata: { greeting: '', starterPrompts: [], dataDirectory: '' }
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

  submitting.value = true;
  try {
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
        metadata: {
          ...form.value.metadata,
          greeting: form.value.metadata?.greeting || '',
          starterPrompts: [...starterPrompts.value],
          dataDirectory: form.value.metadata?.dataDirectory || ''
        }
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
        metadata: {
          ...form.value.metadata,
          greeting: form.value.metadata?.greeting || '',
          starterPrompts: [...starterPrompts.value],
          dataDirectory: form.value.metadata?.dataDirectory || ''
        }
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
      <div class="flex items-center gap-2 text-sm font-medium">
        <div class="flex items-center gap-2" :class="currentStep >= 1 ? 'text-primary' : 'text-muted-foreground'">
          <div
            class="flex h-6 w-6 items-center justify-center rounded-full text-xs"
            :class="currentStep >= 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
            >1</div
          >
          <span>基本信息</span>
        </div>
        <div class="h-px w-8 bg-border"></div>
        <div class="flex items-center gap-2" :class="currentStep >= 2 ? 'text-primary' : 'text-muted-foreground'">
          <div
            class="flex h-6 w-6 items-center justify-center rounded-full text-xs"
            :class="currentStep >= 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
            >2</div
          >
          <span>数据目录</span>
        </div>
        <div class="h-px w-8 bg-border"></div>
        <div class="flex items-center gap-2" :class="currentStep >= 3 ? 'text-primary' : 'text-muted-foreground'">
          <div
            class="flex h-6 w-6 items-center justify-center rounded-full text-xs"
            :class="currentStep >= 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
            >3</div
          >
          <span>人格设置</span>
        </div>
        <div class="h-px w-8 bg-border"></div>
        <div class="flex items-center gap-2" :class="currentStep >= 4 ? 'text-primary' : 'text-muted-foreground'">
          <div
            class="flex h-6 w-6 items-center justify-center rounded-full text-xs"
            :class="currentStep >= 4 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
            >4</div
          >
          <span>技能设置</span>
        </div>
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
                rows="3"
                placeholder="简短描述该智能体的用途..."
                class="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"></textarea>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium">默认模型</label>
              <ModelSelector v-model="form.model" />
              <p class="text-xs text-muted-foreground">留空则使用系统默认模型。</p>
            </div>

            <div class="space-y-3 border-t border-border/40 pt-4">
              <div>
                <label class="text-sm font-medium">默认运行配置</label>
                <p class="mt-1 text-xs text-muted-foreground">新会话默认继承这里的设置，会话内可单独覆盖。</p>
              </div>

              <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div class="grid grid-cols-3 gap-2 rounded-lg bg-muted/35 p-1">
                  <button
                    v-for="item in runtimeOptions"
                    :key="item.value"
                    type="button"
                    class="flex min-h-12 flex-col items-start justify-center rounded-md px-3 text-left transition-colors"
                    :class="
                      form.runtimeType === item.value
                        ? 'bg-background text-primary shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    "
                    @click="form.runtimeType = item.value">
                    <span class="text-xs font-semibold">{{ item.label }}</span>
                    <span class="mt-0.5 truncate text-[10px] opacity-75">{{ item.description }}</span>
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
                  @keydown.enter.prevent="addStarterPrompt" />
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
                      >系统会自动为每个智能体初始化数据目录（<code class="text-xs px-1 py-0.5 rounded bg-background/60"
                        >~/.coobee-agent/data/{'{agentId}'}</code
                      >），您也可以自定义为其他位置</span
                    >
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- 数据目录选择 -->
          <div class="rounded-xl border border-border/40 bg-card p-6 shadow-sm space-y-4 selectable">
            <div class="space-y-2">
              <label class="text-sm font-medium flex items-center gap-2">
                <span class="i-carbon-folder-details text-primary"></span>
                数据目录路径
                <span class="text-xs font-normal text-muted-foreground">（可选，留空使用默认位置）</span>
              </label>
              <div class="flex gap-2">
                <input
                  v-if="form.metadata"
                  type="text"
                  placeholder="留空使用默认位置，或自定义路径，例如：/Users/you/Documents/进销存数据"
                  class="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  :value="(form.metadata.dataDirectory as string) || ''"
                  @input="
                    (e) => {
                      if (form.metadata) form.metadata.dataDirectory = (e.target as HTMLInputElement).value;
                    }
                  " />
                <button
                  type="button"
                  class="shrink-0 flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  @click="selectDataDirectory">
                  <span class="i-carbon-folder-open"></span>
                  浏览选择
                </button>
              </div>
            </div>

            <!-- 预览当前设置 -->
            <div
              v-if="form.metadata?.dataDirectory"
              class="rounded-lg bg-primary/5 border border-primary/20 p-4 selectable">
              <div class="flex items-center gap-2 text-sm">
                <span class="i-carbon-folder-details text-primary"></span>
                <span class="font-medium text-foreground">当前数据目录：</span>
              </div>
              <code
                class="block mt-2 text-xs font-mono text-primary bg-background/60 px-3 py-2 rounded border border-primary/20">
                {{ form.metadata.dataDirectory }}
              </code>
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
          <div class="flex gap-2 border-b border-border">
            <button
              v-for="tab in personalityTabs"
              :key="tab.key"
              class="px-4 py-2.5 text-sm font-medium transition-colors relative"
              :class="
                currentPersonalityTab === tab.key ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              "
              @click="currentPersonalityTab = tab.key">
              {{ tab.label }}
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
            <p class="text-sm text-muted-foreground">为智能体配备外部工具和技能，扩展其能力边界。</p>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 selectable">
            <div
              v-for="skill in availableSkills"
              :key="skill.id"
              class="relative flex cursor-pointer items-start gap-4 rounded-xl border p-4 transition-all"
              :class="
                (form.skills || []).includes(skill.id)
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border/40 bg-card hover:border-border hover:bg-card/80'
              "
              @click="toggleSkill(skill.id)">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <span :class="skill.icon" class="text-xl"></span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between">
                  <h3 class="text-sm font-medium text-foreground">{{ skill.name }}</h3>
                  <div
                    class="flex h-5 w-5 items-center justify-center rounded-full border transition-colors"
                    :class="
                      (form.skills || []).includes(skill.id)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background'
                    ">
                    <span v-if="(form.skills || []).includes(skill.id)" class="i-carbon-checkmark text-xs"></span>
                  </div>
                </div>
                <p class="mt-1 text-xs text-muted-foreground line-clamp-2">{{ skill.description }}</p>
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
