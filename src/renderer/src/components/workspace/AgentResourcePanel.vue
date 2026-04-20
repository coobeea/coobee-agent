<script setup lang="ts">
/**
 * AgentResourcePanel — 智能体资源面板（左侧）
 *
 * 显示智能体的资源：
 *   - 人格文件（IDENTITY.md, SOUL.md, USER.md, NOTES.md, HEARTBEAT.md, AGENTS.md）
 *   - 技能列表
 */

import { ref, computed, onMounted, inject, type Ref } from 'vue';
import { useAgentsStore } from '@/stores/agents';

const props = defineProps<{
  agentId: string;
}>();

const isCollapsed = defineModel<boolean>('collapsed', { default: false });

const agentsStore = useAgentsStore();

// 人格文件列表
const personalityFiles = ref<Record<string, string>>({});
const loadingFiles = ref(false);

// 当前选中的资源
const selectedResource = inject<Ref<{ type: 'personality' | 'skill' | null; name: string | null }>>(
  'selectedResource',
  ref({ type: null, name: null })
);
const setSelectedResource = inject<(type: 'personality' | 'skill', name: string) => void>(
  'setSelectedResource',
  () => {}
);

// 人格文件配置
const personalityFilesList = [
  { key: 'IDENTITY.md', label: 'IDENTITY.md', icon: 'i-carbon-user-avatar', description: '身份名片' },
  { key: 'SOUL.md', label: 'SOUL.md', icon: 'i-carbon-favorite', description: '人格灵魂' },
  { key: 'USER.md', label: 'USER.md', icon: 'i-carbon-user', description: '主人档案' },
  { key: 'NOTES.md', label: 'NOTES.md', icon: 'i-carbon-document', description: '环境备注' },
  { key: 'HEARTBEAT.md', label: 'HEARTBEAT.md', icon: 'i-carbon-activity', description: '心跳任务' },
  { key: 'AGENTS.md', label: 'AGENTS.md', icon: 'i-carbon-rule', description: 'Agent规则' }
];

// 获取当前智能体
const currentAgent = computed(() => {
  return agentsStore.agents.find((a) => a.id === props.agentId);
});

// 技能列表
const skills = computed(() => {
  return currentAgent.value?.skills || [];
});

// 加载人格文件
async function loadPersonalityFiles(): Promise<void> {
  loadingFiles.value = true;
  try {
    const files = await agentsStore.getPersonalityFiles(props.agentId);
    personalityFiles.value = files;
  } catch (err) {
    console.error('[AgentResourcePanel] Failed to load personality files:', err);
  } finally {
    loadingFiles.value = false;
  }
}

// 点击人格文件
function handleFileClick(fileName: string): void {
  setSelectedResource('personality', fileName);
}

// 点击技能
function handleSkillClick(skillName: string): void {
  setSelectedResource('skill', skillName);
}

// 判断文件是否为空或仅包含模板
function isFileEmpty(fileName: string): boolean {
  const content = personalityFiles.value[fileName];
  if (!content || content.trim().length === 0) return true;

  // 检查是否只包含注释（模板）
  const stripped = content
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('<!--') && !trimmed.endsWith('-->');
    })
    .join('')
    .trim();

  return stripped.length === 0;
}

onMounted(() => {
  loadPersonalityFiles();
});
</script>

<template>
  <aside v-show="!isCollapsed" class="resource-panel">
    <!-- 面板标题 -->
    <div class="panel-header">
      <div class="header-left">
        <span class="i-carbon-folder-details inline-block h-3.5 w-3.5 text-muted-foreground/60"></span>
        <span class="header-title">资源</span>
      </div>
      <div class="header-right">
        <button class="header-btn" title="刷新" @click="loadPersonalityFiles">
          <span class="i-carbon-renew inline-block h-3.5 w-3.5" :class="{ 'animate-spin': loadingFiles }"></span>
        </button>
        <button class="header-btn" title="折叠面板" @click="isCollapsed = true">
          <span class="i-carbon-chevron-left inline-block h-3 w-3"></span>
        </button>
      </div>
    </div>

    <!-- 内容区域 -->
    <div class="panel-content">
      <!-- 人格文件 -->
      <div class="resource-section">
        <div class="section-title">
          <span class="i-carbon-document inline-block h-3 w-3" />
          <span>人格文件</span>
        </div>
        <div class="resource-list">
          <div
            v-for="file in personalityFilesList"
            :key="file.key"
            class="resource-item"
            :class="{
              active: selectedResource.type === 'personality' && selectedResource.name === file.key,
              empty: isFileEmpty(file.key)
            }"
            @click="handleFileClick(file.key)">
            <span :class="file.icon" class="resource-icon" />
            <div class="resource-info">
              <span class="resource-name">{{ file.label }}</span>
              <span class="resource-desc">{{ file.description }}</span>
            </div>
            <span v-if="isFileEmpty(file.key)" class="empty-badge">空</span>
          </div>
        </div>
      </div>

      <!-- 技能列表 -->
      <div class="resource-section">
        <div class="section-title">
          <span class="i-carbon-skill-level-advanced inline-block h-3 w-3" />
          <span>技能</span>
          <span v-if="skills.length > 0" class="section-count">{{ skills.length }}</span>
        </div>
        <div class="resource-list">
          <div
            v-for="skill in skills"
            :key="skill"
            class="resource-item"
            :class="{ active: selectedResource.type === 'skill' && selectedResource.name === skill }"
            @click="handleSkillClick(skill)">
            <span class="i-carbon-cube inline-block h-3.5 w-3.5 resource-icon" />
            <div class="resource-info">
              <span class="resource-name">{{ skill }}</span>
            </div>
          </div>

          <!-- 技能为空 -->
          <div v-if="skills.length === 0" class="resource-empty">
            <span class="i-carbon-cube inline-block h-5 w-5 opacity-10" />
            <p>未配置技能</p>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.resource-panel {
  display: flex;
  flex-direction: column;
  width: 256px;
  flex-shrink: 0;
  background: hsl(var(--surface) / 0.5);
  border-right: 1px solid hsl(var(--border) / 0.4);
}

/* 面板标题 */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 12px;
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.6);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-title {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.9);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 2px;
}

.header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: all 0.15s ease;
}

.header-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.7);
}

/* 内容区域 */
.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 资源分组 */
.resource-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
  color: hsl(var(--muted-foreground) / 0.75);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.section-count {
  margin-left: auto;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--muted-foreground) / 0.5);
}

.resource-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* 资源项 */
.resource-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}

.resource-item:hover {
  background: hsl(var(--foreground) / 0.04);
  border-color: hsl(var(--border) / 0.4);
}

.resource-item.active {
  background: hsl(var(--primary) / 0.1);
  border-color: hsl(var(--primary) / 0.2);
}

.resource-item.empty {
  opacity: 0.5;
}

.resource-icon {
  flex-shrink: 0;
  color: hsl(var(--muted-foreground) / 0.5);
}

.resource-item.active .resource-icon {
  color: hsl(var(--primary) / 0.7);
}

.resource-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.resource-name {
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.95);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.resource-item.active .resource-name {
  color: hsl(var(--primary));
  font-weight: 600;
}

.resource-desc {
  font-size: 10px;
  color: hsl(var(--muted-foreground) / 0.5);
}

.resource-item.active .resource-desc {
  color: hsl(var(--primary) / 0.5);
}

.empty-badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 4px;
  background: hsl(var(--muted-foreground) / 0.08);
  color: hsl(var(--muted-foreground) / 0.4);
  flex-shrink: 0;
}

/* 空状态 */
.resource-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 16px;
  color: hsl(var(--muted-foreground) / 0.4);
  font-size: 11px;
  text-align: center;
}

/* 滚动条 */
.panel-content::-webkit-scrollbar {
  width: 4px;
}

.panel-content::-webkit-scrollbar-thumb {
  background: hsl(var(--foreground) / 0.1);
  border-radius: 4px;
}

.panel-content::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--foreground) / 0.2);
}
</style>
