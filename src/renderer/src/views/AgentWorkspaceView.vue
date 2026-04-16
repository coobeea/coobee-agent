<script setup lang="ts">
/**
 * AgentWorkspaceView — 智能体工作区视图
 *
 * 根据路由参数 :id 加载 Agent，展示三栏工作区（文件树 | 工作台 | 智能体信息+对话）。
 * 左侧支持切换：智能体目录 / 任务工作目录
 */

import { ref, computed, watch, onMounted, provide } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAgentsStore } from '@/stores/agents';
import { useOpenFiles } from '@/composables/useOpenFiles';

import ProjectPanel from '@/components/agent/ProjectPanel.vue';
import WorkbenchPanel from '@/components/agent/WorkbenchPanel.vue';
import AgentChatPanel from '@/components/workspace/AgentChatPanel.vue';

const route = useRoute();
const router = useRouter();
const agentsStore = useAgentsStore();
const { closeAllFiles } = useOpenFiles();

const leftCollapsed = ref(false);
const rightCollapsed = ref(false);

const projectPath = ref<string | null>(null);
const workspaceReady = computed(() => projectPath.value !== null);

// 智能体 ID
const agentId = computed(() => route.params.id as string);

// 当前智能体
const currentAgent = computed(() => {
  return agentsStore.agents.find(a => a.id === agentId.value);
});

// 目录切换：智能体目录 / 任务工作目录
type DirectoryMode = 'agent-home' | 'workspace';
const directoryMode = ref<DirectoryMode>('agent-home');

// 提供给子组件
provide('directoryMode', directoryMode);
provide('toggleDirectoryMode', toggleDirectoryMode);
provide('addToChat', () => {}); // 暂时空实现
provide('addFileToTask', undefined);

// 根据当前模式更新显示的目录路径
function updateProjectPathForMode(agent: any): void {
  if (directoryMode.value === 'agent-home') {
    // 智能体家目录：.home/agents/{agentId}/
    projectPath.value = agent.agentHomePath || agent.workspacePath || '';
  } else {
    // 任务工作目录：.home/agents/{agentId}/workspace/
    projectPath.value = agent.workspacePath || agent.agentHomePath || '';
  }
}

// 切换目录模式
function toggleDirectoryMode(): void {
  const agent = currentAgent.value;
  if (!agent) return;

  directoryMode.value = directoryMode.value === 'agent-home' ? 'workspace' : 'agent-home';
  updateProjectPathForMode(agent);
}

// 返回智能体列表
function goBackToAgents(): void {
  router.push('/agents');
}

// 进入工作区
function enterWorkspaceForAgent(id: string): void {
  const agent = agentsStore.agents.find(a => a.id === id);
  
  directoryMode.value = 'agent-home';
  
  if (agent) {
    updateProjectPathForMode(agent);
  }
  
  closeAllFiles();
}

// 监听路由变化
watch(agentId, async (newId) => {
  if (newId) {
    if (agentsStore.agents.length === 0) {
      await agentsStore.fetchAgents();
    }
    enterWorkspaceForAgent(newId);
  }
});

onMounted(async () => {
  if (agentsStore.agents.length === 0) {
    await agentsStore.fetchAgents();
  }
  
  if (!currentAgent.value) {
    console.error('[AgentWorkspaceView] Agent not found:', agentId.value);
    goBackToAgents();
    return;
  }
  
  enterWorkspaceForAgent(agentId.value);
});
</script>

<template>
  <div class="agent-workspace">
    <!-- 智能体未找到 -->
    <div v-if="!currentAgent" class="not-found">
      <div class="not-found-card">
        <div class="not-found-icon">
          <span class="i-carbon-warning-alt inline-block h-8 w-8" />
        </div>
        <h2 class="not-found-title">智能体不存在</h2>
        <p class="not-found-desc">
          未找到智能体 ID: {{ agentId }}<br />
          可能已被删除或不存在
        </p>
        <button class="not-found-btn" @click="goBackToAgents">
          <span class="i-carbon-arrow-left inline-block h-4 w-4" />
          <span>返回列表</span>
        </button>
      </div>
    </div>

    <!-- 三栏工作区 -->
    <div v-else class="workspace-layout">
      <!-- 左侧折叠时的展开条 -->
      <div
        v-if="leftCollapsed"
        class="expand-bar left"
        title="展开文件树"
        @click="leftCollapsed = false">
        <span class="i-carbon-chevron-right inline-block h-3 w-3"></span>
      </div>

      <!-- 左侧面板：文件树 -->
      <ProjectPanel
        v-if="!leftCollapsed"
        v-model:project-path="projectPath"
        v-model:collapsed="leftCollapsed"
        :agent-id="agentId" />

      <!-- 中间面板：工作台 -->
      <div class="middle-area">
        <WorkbenchPanel />
      </div>

      <!-- 右侧折叠时的展开条 -->
      <div
        v-if="rightCollapsed"
        class="expand-bar right"
        title="展开信息面板"
        @click="rightCollapsed = false">
        <span class="i-carbon-chevron-left inline-block h-3 w-3"></span>
      </div>

      <!-- 右侧面板：智能体信息 + 对话 -->
      <AgentChatPanel
        v-if="!rightCollapsed"
        v-model:collapsed="rightCollapsed"
        :agent-id="agentId" />
    </div>
  </div>
</template>

<style scoped>
.agent-workspace {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  background: hsl(var(--background));
}

.workspace-layout {
  display: flex;
  flex: 1;
  min-height: 0;
}

.middle-area {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* 展开条 */
.expand-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  flex-shrink: 0;
  cursor: pointer;
  background: hsl(var(--surface) / 0.5);
  color: hsl(var(--muted-foreground) / 0.3);
  transition: all 0.15s ease;
}

.expand-bar:hover {
  background: hsl(var(--surface));
  color: hsl(var(--muted-foreground) / 0.6);
}

.expand-bar.left {
  border-right: 1px solid hsl(var(--border) / 0.4);
}

.expand-bar.right {
  border-left: 1px solid hsl(var(--border) / 0.4);
}

/* 未找到页面 */
.not-found {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  background: hsl(var(--background));
}

.not-found-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 360px;
  padding: 40px;
}

.not-found-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: hsl(var(--error) / 0.08);
  color: hsl(var(--error) / 0.5);
  margin-bottom: 24px;
}

.not-found-title {
  font-size: 17px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 8px;
}

.not-found-desc {
  font-size: 13px;
  line-height: 1.7;
  color: hsl(var(--muted-foreground) / 0.75);
  margin-bottom: 28px;
}

.not-found-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 20px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
  transition: all 0.15s ease;
}

.not-found-btn:hover {
  background: hsl(var(--primary-hover));
  box-shadow: 0 2px 12px hsl(var(--primary) / 0.2);
}
</style>
