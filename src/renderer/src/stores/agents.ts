/**
 * Agent 列表 Store
 *
 * 管理前端的 Agent 列表状态，通过 HTTP REST API 获取数据。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  getAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  getPersonalityFiles as fetchPersonalityFiles,
  updatePersonalityFile as savePersonalityFile,
  type AgentEntry,
  type CreateAgentParams
} from '@/api/agents';

export const useAgentsStore = defineStore('agents', () => {
  // ==================== State ====================

  const agents = ref<AgentEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** 当前选中的 Agent ID */
  const selectedAgentId = ref<string | null>(null);

  // ==================== Getters ====================

  const agentCount = computed(() => agents.value.length);

  const selectedAgent = computed(() =>
    agents.value.find((a) => a.id === selectedAgentId.value) ?? null
  );

  // ==================== Actions ====================

  /** 加载 Agent 列表 */
  async function fetchAgents(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      const result = await getAgents();
      if (result.success && result.data) {
        agents.value = result.data.agents;
      } else {
        error.value = result.error || '加载失败';
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      console.warn('[AgentsStore] Failed to fetch agents:', err);
    } finally {
      loading.value = false;
    }
  }

  /** 创建 Agent */
  async function createNewAgent(params: CreateAgentParams): Promise<boolean> {
    try {
      console.log('[AgentsStore] Creating agent with params:', {
        id: params.id,
        name: params.name,
        descriptionLength: params.description.length,
        instructionsLength: params.instructions.length,
        skills: params.skills,
        model: params.model
      });
      
      const result = await createAgent(params);
      
      console.log('[AgentsStore] Create result:', {
        success: result.success,
        error: result.error
      });
      
      if (result.success) {
        await fetchAgents();
        return true;
      } else {
        error.value = result.error || '创建失败';
        console.error('[AgentsStore] Create failed:', result.error);
        return false;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      console.error('[AgentsStore] Failed to create agent:', err);
      return false;
    }
  }

  /** 删除 Agent */
  async function removeAgent(agentId: string): Promise<boolean> {
    try {
      const result = await deleteAgent(agentId);
      if (result.success) {
        agents.value = agents.value.filter((a) => a.id !== agentId);
        if (selectedAgentId.value === agentId) {
          selectedAgentId.value = null;
        }
        return true;
      } else {
        error.value = result.error || '删除失败';
        return false;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      console.warn('[AgentsStore] Failed to delete agent:', err);
      return false;
    }
  }

  /** 更新 Agent（部分更新） */
  async function modifyAgent(
    agentId: string,
    params: { skills?: string[]; model?: string; name?: string; description?: string; instructions?: string }
  ): Promise<boolean> {
    try {
      const result = await updateAgent(agentId, params);
      if (result.success) {
        await fetchAgents();
        return true;
      } else {
        error.value = result.error || '更新失败';
        return false;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      console.warn('[AgentsStore] Failed to update agent:', err);
      return false;
    }
  }

  /** 获取单个 Agent 详情 */
  async function getAgentDetail(agentId: string) {
    try {
      const { getAgent } = await import('@/api/agents');
      const result = await getAgent(agentId);
      if (result.success && result.data) {
        return result.data.agent;
      }
    } catch (err) {
      console.warn('[AgentsStore] Failed to get agent detail:', err);
    }
    return null;
  }

  /** 选中 Agent */
  function selectAgent(agentId: string | null): void {
    selectedAgentId.value = agentId;
  }

  // ==================== Personality Files ====================

  /** 获取智能体的人格文件 */
  async function getPersonalityFiles(agentId: string): Promise<Record<string, string> | null> {
    try {
      const result = await fetchPersonalityFiles(agentId);
      if (result.success && result.data) {
        return result.data.files;
      } else {
        error.value = result.error || '获取人格文件失败';
        return null;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      console.error('[AgentsStore] Failed to get personality files:', err);
      return null;
    }
  }

  /** 更新智能体的人格文件 */
  async function updatePersonalityFile(
    agentId: string,
    fileName: string,
    content: string
  ): Promise<boolean> {
    try {
      const result = await savePersonalityFile(agentId, fileName, content);
      if (result.success) {
        return true;
      } else {
        error.value = result.error || '更新人格文件失败';
        return false;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      console.error('[AgentsStore] Failed to update personality file:', err);
      return false;
    }
  }

  return {
    // State
    agents,
    loading,
    error,
    selectedAgentId,
    // Getters
    agentCount,
    selectedAgent,
    // Actions
    fetchAgents,
    createNewAgent,
    removeAgent,
    modifyAgent,
    getAgentDetail,
    selectAgent,
    getPersonalityFiles,
    updatePersonalityFile
  };
});
