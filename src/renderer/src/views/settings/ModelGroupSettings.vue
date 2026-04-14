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
    <div class="flex w-64 flex-col border-r border-border bg-card/30">
      <div class="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 class="text-base font-semibold tracking-tight">模型分组</h2>
          <p class="mt-1 text-xs text-muted-foreground">{{ groups.length }} 个分组</p>
        </div>
        <button class="flex h-8 w-8 items-center justify-center rounded-full text-primary hover:bg-primary/10 transition-colors">
          <span class="i-carbon-add text-lg"></span>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-3">
        <div v-if="loading" class="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <span class="i-carbon-circle-dash animate-spin text-2xl mb-3 text-primary/70"></span>
          <p class="text-sm font-medium">加载中...</p>
        </div>
        
        <div v-else class="flex flex-col gap-1.5">
          <button
            v-for="group in groups"
            :key="group.id"
            :class="[
              'flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-sm transition-all border border-transparent',
              selectedGroupId === group.id
                ? 'bg-primary/10 border-primary/20 text-primary shadow-sm'
                : 'text-foreground hover:bg-muted hover:border-border/50'
            ]"
            @click="selectGroup(group.id)">
            <div class="flex flex-col overflow-hidden">
              <span class="truncate font-medium">{{ group.name }}</span>
              <span class="mt-1 text-[11px] font-medium text-muted-foreground truncate">
                {{ group.models.length }} 个模型 · {{ getStrategyLabel(group.strategy) }}
              </span>
            </div>
            <div :class="['h-2.5 w-2.5 flex-shrink-0 rounded-full shadow-sm', group.enabled ? 'bg-green-500' : 'bg-gray-400/50']"></div>
          </button>
        </div>
      </div>
    </div>

    <!-- 右侧：分组详情 -->
    <div class="flex-1 overflow-y-auto bg-background p-8 lg:p-12">
      <div v-if="selectedGroup" class="mx-auto max-w-3xl">
        <div class="mb-8 flex items-start justify-between">
          <div>
            <h1 class="text-3xl font-bold tracking-tight">{{ selectedGroup.name }}</h1>
            <p class="mt-2 text-sm text-muted-foreground">{{ selectedGroup.description || '无描述' }}</p>
          </div>
          <button class="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm">
            <span class="i-carbon-edit"></span>
            编辑分组
          </button>
        </div>

        <div class="space-y-8">
          <div class="rounded-xl border border-border bg-card p-8 shadow-sm">
            <h3 class="text-lg font-semibold tracking-tight border-b border-border pb-4 mb-6">基本信息</h3>
            
            <div class="grid grid-cols-2 gap-6 text-sm">
              <div>
                <span class="text-muted-foreground font-medium block mb-2">分组 ID</span>
                <code class="bg-muted/50 px-2.5 py-1 rounded-md font-mono text-xs border border-border/50">{{ selectedGroup.id }}</code>
              </div>
              <div>
                <span class="text-muted-foreground font-medium block mb-2">状态</span>
                <span :class="['inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset', selectedGroup.enabled ? 'bg-green-500/10 text-green-700 dark:text-green-400 ring-green-500/20' : 'bg-gray-500/10 text-gray-700 dark:text-gray-400 ring-gray-500/20']">
                  {{ selectedGroup.enabled ? '已启用' : '已禁用' }}
                </span>
              </div>
              <div class="col-span-2">
                <span class="text-muted-foreground font-medium block mb-2">负载均衡策略</span>
                <div class="flex items-center gap-3 bg-background border border-border rounded-lg p-4">
                  <div class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <span class="i-carbon-flow-data text-xl"></span>
                  </div>
                  <div>
                    <span class="font-semibold text-base block">{{ getStrategyLabel(selectedGroup.strategy) }}</span>
                    <span class="text-sm text-muted-foreground mt-0.5 block">
                      {{ STRATEGIES.find(s => s.value === selectedGroup?.strategy)?.desc }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-xl border border-border bg-card p-8 shadow-sm">
            <h3 class="text-lg font-semibold tracking-tight border-b border-border pb-4 mb-6 flex items-center justify-between">
              <span>包含的模型</span>
              <span class="inline-flex items-center justify-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                {{ selectedGroup.models.length }}
              </span>
            </h3>
            
            <div class="flex flex-col gap-3">
              <div 
                v-for="(modelId, index) in selectedGroup.models" 
                :key="modelId"
                class="flex items-center gap-4 p-4 rounded-lg border border-border bg-background shadow-sm hover:border-primary/30 transition-colors"
              >
                <div class="flex h-8 w-8 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground shrink-0 shadow-inner">
                  {{ index + 1 }}
                </div>
                <div class="flex-1 font-mono text-sm font-medium">{{ modelId }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div v-else class="flex h-full items-center justify-center text-muted-foreground">
        <div class="text-center">
          <span class="i-carbon-group-objects text-5xl mb-4 opacity-20 block mx-auto"></span>
          <p class="text-lg font-medium text-foreground">未选择分组</p>
          <p class="mt-2 text-sm">请在左侧选择一个模型分组进行查看</p>
        </div>
      </div>
    </div>
  </div>
</template>
