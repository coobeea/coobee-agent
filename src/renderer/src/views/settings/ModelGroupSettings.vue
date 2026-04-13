<script setup lang="ts">
/**
 * ModelGroupSettings - 模型分组管理
 */

import { ref, computed, onMounted } from 'vue';

type LoadBalanceStrategy = 'round-robin' | 'random' | 'weighted' | 'quota-aware' | 'fallback';

interface ModelGroup {
  id: string;
  name: string;
  description?: string;
  models: string[];
  strategy: LoadBalanceStrategy;
  enabled: boolean;
}

const groups = ref<ModelGroup[]>([]);
const selectedGroupId = ref<string>('');
const loading = ref(true);

const STRATEGIES: { value: LoadBalanceStrategy; label: string; desc: string }[] = [
  { value: 'round-robin', label: '轮询', desc: '依次使用每个模型' },
  { value: 'random', label: '随机', desc: '随机选择模型' },
  { value: 'weighted', label: '加权', desc: '按权重分配请求' },
  { value: 'quota-aware', label: '配额感知', desc: '优先使用剩余额度多的模型' },
  { value: 'fallback', label: '故障转移', desc: '优先使用第一个，失败则切换' }
];

async function loadData(): Promise<void> {
  loading.value = true;
  try {
    // TODO: 对接实际 API
    await new Promise(resolve => setTimeout(resolve, 800));
    
    groups.value = [
      {
        id: 'coding-group',
        name: '编程助手组',
        description: '用于代码生成的模型集合',
        models: ['gpt-4o', 'claude-3-5-sonnet'],
        strategy: 'fallback',
        enabled: true
      },
      {
        id: 'chat-group',
        name: '日常对话组',
        description: '快速响应的日常对话模型',
        models: ['gpt-4o-mini', 'qwen-max'],
        strategy: 'round-robin',
        enabled: true
      }
    ];
    
    if (groups.value.length > 0) {
      selectedGroupId.value = groups.value[0].id;
    }
  } catch (err) {
    console.error('加载分组失败:', err);
  } finally {
    loading.value = false;
  }
}

const selectedGroup = computed(() => groups.value.find(g => g.id === selectedGroupId.value));

function selectGroup(id: string) {
  selectedGroupId.value = id;
}

function getStrategyLabel(val: string) {
  return STRATEGIES.find(s => s.value === val)?.label || val;
}

onMounted(() => {
  loadData();
});
</script>

<template>
  <div class="flex h-full bg-background text-foreground">
    <!-- 左侧：分组列表 -->
    <div class="flex w-64 flex-col border-r border-border bg-card">
      <div class="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 class="text-sm font-semibold">模型分组</h2>
        <button class="text-primary hover:text-primary/80">
          <span class="i-carbon-add text-lg"></span>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-3">
        <div v-if="loading" class="flex justify-center py-8 text-muted-foreground">
          <span class="i-carbon-circle-dash animate-spin text-xl"></span>
        </div>
        
        <div v-else class="flex flex-col gap-1">
          <button
            v-for="group in groups"
            :key="group.id"
            :class="[
              'flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm transition-colors',
              selectedGroupId === group.id
                ? 'bg-primary/10 text-primary'
                : 'text-foreground hover:bg-muted'
            ]"
            @click="selectGroup(group.id)">
            <div class="flex flex-col overflow-hidden">
              <span class="truncate font-medium">{{ group.name }}</span>
              <span class="mt-0.5 text-[10px] text-muted-foreground truncate">
                {{ group.models.length }} 个模型 · {{ getStrategyLabel(group.strategy) }}
              </span>
            </div>
            <div :class="['h-2 w-2 flex-shrink-0 rounded-full', group.enabled ? 'bg-green-500' : 'bg-gray-400']"></div>
          </button>
        </div>
      </div>
    </div>

    <!-- 右侧：分组详情 -->
    <div class="flex-1 overflow-y-auto p-6">
      <div v-if="selectedGroup" class="mx-auto max-w-2xl">
        <div class="mb-6 flex items-start justify-between">
          <div>
            <h1 class="text-2xl font-bold">{{ selectedGroup.name }}</h1>
            <p class="mt-1 text-sm text-muted-foreground">{{ selectedGroup.description || '无描述' }}</p>
          </div>
          <button class="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">
            编辑分组
          </button>
        </div>

        <div class="space-y-6">
          <div class="rounded-lg border border-border bg-card p-5">
            <h3 class="text-base font-medium border-b border-border pb-2 mb-4">基本信息</h3>
            
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span class="text-muted-foreground block mb-1">分组 ID</span>
                <code class="bg-muted px-1.5 py-0.5 rounded font-mono">{{ selectedGroup.id }}</code>
              </div>
              <div>
                <span class="text-muted-foreground block mb-1">状态</span>
                <span :class="selectedGroup.enabled ? 'text-green-600' : 'text-gray-500'">
                  {{ selectedGroup.enabled ? '已启用' : '已禁用' }}
                </span>
              </div>
              <div class="col-span-2">
                <span class="text-muted-foreground block mb-1">负载均衡策略</span>
                <div class="flex items-center gap-2">
                  <span class="font-medium">{{ getStrategyLabel(selectedGroup.strategy) }}</span>
                  <span class="text-xs text-muted-foreground">
                    ({{ STRATEGIES.find(s => s.value === selectedGroup?.strategy)?.desc }})
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-border bg-card p-5">
            <h3 class="text-base font-medium border-b border-border pb-2 mb-4">包含的模型 ({{ selectedGroup.models.length }})</h3>
            
            <div class="flex flex-col gap-2">
              <div 
                v-for="(modelId, index) in selectedGroup.models" 
                :key="modelId"
                class="flex items-center gap-3 p-3 rounded-md border border-border bg-background"
              >
                <div class="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground shrink-0">
                  {{ index + 1 }}
                </div>
                <div class="flex-1 font-mono text-sm">{{ modelId }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div v-else class="flex h-full items-center justify-center text-muted-foreground">
        <div class="text-center">
          <span class="i-carbon-group-objects text-4xl mb-3 opacity-20 block mx-auto"></span>
          <p>请在左侧选择一个模型分组</p>
        </div>
      </div>
    </div>
  </div>
</template>
