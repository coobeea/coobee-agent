<script setup lang="ts">
/**
 * AgentWorkbenchPanel — 智能体工作台（中间）
 *
 * 显示和编辑选中的资源：
 *   - 人格文件编辑器
 *   - 技能详情
 *   - 欢迎页面（默认）
 */

import { ref, computed, watch, inject, type Ref } from 'vue';
import { useAgentsStore } from '@/stores/agents';
import MarkdownEditor from '@/components/MarkdownEditor.vue';

const props = defineProps<{
  agentId: string;
}>();

const agentsStore = useAgentsStore();

// 从父组件注入选中的资源
const selectedResource = inject<Ref<{ type: 'personality' | 'skill' | null; name: string | null }>>(
  'selectedResource',
  ref({ type: null, name: null })
);

// 人格文件内容
const personalityFiles = ref<Record<string, string>>({});
const loadingFiles = ref(false);
const savingFile = ref(false);

// 当前编辑的文件内容
const currentFileContent = ref('');

// 获取当前智能体
const currentAgent = computed(() => {
  return agentsStore.agents.find(a => a.id === props.agentId);
});

// 加载人格文件
async function loadPersonalityFiles(): Promise<void> {
  loadingFiles.value = true;
  try {
    const files = await agentsStore.getPersonalityFiles(props.agentId);
    personalityFiles.value = files;
    
    // 如果当前选中的是人格文件，更新内容
    if (selectedResource.value.type === 'personality' && selectedResource.value.name) {
      currentFileContent.value = files[selectedResource.value.name] || '';
    }
  } catch (err) {
    console.error('[AgentWorkbenchPanel] Failed to load personality files:', err);
  } finally {
    loadingFiles.value = false;
  }
}

// 保存人格文件
async function saveCurrentFile(): Promise<void> {
  if (selectedResource.value.type !== 'personality' || !selectedResource.value.name) return;
  
  savingFile.value = true;
  try {
    await agentsStore.updatePersonalityFile(
      props.agentId,
      selectedResource.value.name,
      currentFileContent.value
    );
    
    // 更新本地缓存
    personalityFiles.value[selectedResource.value.name] = currentFileContent.value;
  } catch (err) {
    console.error('[AgentWorkbenchPanel] Failed to save file:', err);
  } finally {
    savingFile.value = false;
  }
}

// 监听选中资源变化
watch(selectedResource, async (newResource) => {
  if (newResource.type === 'personality' && newResource.name) {
    // 切换文件前先保存当前文件
    if (currentFileContent.value !== personalityFiles.value[newResource.name]) {
      await saveCurrentFile();
    }
    
    // 加载新文件内容
    if (!personalityFiles.value[newResource.name]) {
      await loadPersonalityFiles();
    }
    currentFileContent.value = personalityFiles.value[newResource.name] || '';
  }
}, { deep: true });

// 监听内容变化，自动保存（防抖）
let saveTimer: number | null = null;
watch(currentFileContent, () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveCurrentFile();
  }, 1000);
});
</script>

<template>
  <div class="workbench-panel">
    <!-- 欢迎页面（未选中任何资源） -->
    <div v-if="!selectedResource.type" class="welcome">
      <div class="welcome-icon">
        <span class="i-carbon-bot inline-block h-12 w-12" />
      </div>
      <h2 class="welcome-title">{{ currentAgent?.name }}</h2>
      <p class="welcome-desc">{{ currentAgent?.description }}</p>
      <div class="welcome-hint">
        <span class="i-carbon-information inline-block h-3.5 w-3.5" />
        <span>从左侧选择资源开始编辑</span>
      </div>
    </div>

    <!-- 人格文件编辑器 -->
    <div v-else-if="selectedResource.type === 'personality'" class="editor-container">
      <div class="editor-header">
        <div class="editor-title">
          <span class="i-carbon-document inline-block h-3.5 w-3.5" />
          <span>{{ selectedResource.name }}</span>
        </div>
        <div class="editor-actions">
          <span v-if="savingFile" class="saving-indicator">
            <span class="i-carbon-renew inline-block h-3 w-3 animate-spin" />
            <span>保存中...</span>
          </span>
          <button class="editor-btn" title="保存" @click="saveCurrentFile">
            <span class="i-carbon-save inline-block h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div class="editor-body">
        <MarkdownEditor
          v-model="currentFileContent"
          :placeholder="`编辑 ${selectedResource.name}...`"
          min-height="100%" />
      </div>
    </div>

    <!-- 技能详情（暂时简单展示） -->
    <div v-else-if="selectedResource.type === 'skill'" class="skill-detail">
      <div class="skill-header">
        <span class="i-carbon-cube inline-block h-4 w-4" />
        <h3>{{ selectedResource.name }}</h3>
      </div>
      <p class="skill-desc">技能详情功能开发中...</p>
    </div>
  </div>
</template>

<style scoped>
.workbench-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: hsl(var(--background));
}

/* 欢迎页面 */
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 40px;
  text-align: center;
}

.welcome-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 96px;
  height: 96px;
  border-radius: 24px;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary) / 0.4);
  margin-bottom: 24px;
}

.welcome-title {
  font-size: 20px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 8px;
}

.welcome-desc {
  font-size: 14px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground) / 0.75);
  max-width: 400px;
  margin-bottom: 32px;
}

.welcome-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  background: hsl(var(--muted) / 0.3);
  color: hsl(var(--muted-foreground) / 0.75);
  font-size: 12px;
}

/* 编辑器容器 */
.editor-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.4);
}

.editor-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.95);
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.saving-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.5);
}

.editor-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: all 0.15s ease;
}

.editor-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--primary));
}

.editor-body {
  flex: 1;
  min-height: 0;
  padding: 16px;
  overflow: hidden;
}

.editor-body :deep(.markdown-editor) {
  height: 100%;
}

/* 技能详情 */
.skill-detail {
  display: flex;
  flex-direction: column;
  padding: 24px;
  gap: 16px;
}

.skill-header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.skill-desc {
  font-size: 13px;
  color: hsl(var(--muted-foreground) / 0.6);
}
</style>
