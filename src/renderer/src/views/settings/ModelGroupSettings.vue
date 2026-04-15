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
    <div class="flex w-72 flex-col border-r border-border bg-surface">
      <div class="flex items-center justify-between px-5 py-4 border-b border-border/50">
        <h2 class="text-sm font-semibold tracking-tight text-foreground">模型分组</h2>
        <button class="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors" title="新建分组">
          <span class="i-carbon-add text-base"></span>
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
              'group flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition-all duration-200 border',
              selectedGroupId === group.id
                ? 'bg-primary/5 border-primary/20 text-primary shadow-sm'
                : 'bg-transparent border-transparent text-foreground hover:bg-muted/50 hover:border-border/50'
            ]"
            @click="selectGroup(group.id)">
            <div class="flex items-center gap-3 overflow-hidden w-full">
              <div :class="[
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold text-base transition-colors',
                selectedGroupId === group.id 
                  ? 'bg-primary text-primary-foreground shadow-md' 
                  : (group.enabled ? 'bg-primary/10 text-primary group-hover:bg-primary/20' : 'bg-muted text-muted-foreground')
              ]">
                <span class="i-carbon-group-objects"></span>
              </div>
              <div class="flex flex-col overflow-hidden flex-1">
                <div class="flex items-center justify-between w-full mb-1">
                  <span :class="['truncate font-semibold tracking-tight text-[14px]', selectedGroupId === group.id ? 'text-primary' : 'text-foreground']">{{ group.name }}</span>
                  <div :class="[
                    'h-2 w-2 shrink-0 rounded-full transition-colors',
                    group.enabled ? (selectedGroupId === group.id ? 'bg-primary' : 'bg-green-500') : 'bg-muted-foreground/30'
                  ]"></div>
                </div>
                <span :class="[
                  'text-[12px] font-medium truncate',
                  selectedGroupId === group.id 
                    ? 'text-primary/70' 
                    : 'text-muted-foreground'
                ]">
                  {{ group.models.length }} 个模型 · {{ getStrategyLabel(group.strategy) }}
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>

    <!-- 右侧：分组详情 -->
    <div class="flex-1 overflow-y-auto bg-background p-8 lg:p-12">
      <div v-if="selectedGroup" class="mx-auto max-w-3xl">
        <div class="mb-8 flex items-start justify-between">
          <div>
            <h1 class="text-3xl font-bold tracking-tight text-foreground">{{ selectedGroup.name }}</h1>
            <p class="mt-2 text-sm text-muted-foreground">{{ selectedGroup.description || '暂无描述信息' }}</p>
          </div>
          <div class="flex items-center gap-3">
            <button class="flex items-center gap-2 px-4 py-2 border border-border bg-card text-foreground rounded-lg text-sm font-medium hover:bg-muted transition-colors shadow-sm">
              <span class="i-carbon-trash-can text-red-500"></span>
              删除
            </button>
            <button class="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm">
              <span class="i-carbon-edit"></span>
              编辑分组
            </button>
          </div>
        </div>

        <div class="space-y-6">
          <!-- 基本信息卡片 -->
          <div class="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-border/50 bg-muted/20 flex items-center justify-between">
              <h3 class="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                <span class="i-carbon-information text-primary"></span>
                基本信息
              </h3>
              <span :class="['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border', selectedGroup.enabled ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20' : 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-500/10 dark:text-gray-400 dark:border-gray-500/20']">
                {{ selectedGroup.enabled ? '已启用' : '已禁用' }}
              </span>
            </div>
            
            <div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-8 text-sm">
              <div>
                <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-2">分组 ID</span>
                <code class="bg-muted/50 px-3 py-1.5 rounded-md font-mono text-xs border border-border/50 text-foreground">{{ selectedGroup.id }}</code>
              </div>
              
              <div class="col-span-1 md:col-span-2">
                <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-2">负载均衡策略</span>
                <div class="flex items-center gap-4 bg-muted/30 border border-border/50 rounded-lg p-4">
                  <div class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                    <span class="i-carbon-flow-data text-xl"></span>
                  </div>
                  <div>
                    <span class="font-semibold text-foreground block">{{ getStrategyLabel(selectedGroup.strategy) }}</span>
                    <span class="text-xs text-muted-foreground mt-1 block">
                      {{ STRATEGIES.find(s => s.value === selectedGroup?.strategy)?.desc }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 模型列表卡片 -->
          <div class="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-border/50 bg-muted/20 flex items-center justify-between">
              <h3 class="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                <span class="i-carbon-machine-learning-model text-primary"></span>
                包含的模型
              </h3>
              <span class="inline-flex items-center justify-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary border border-primary/20">
                {{ selectedGroup.models.length }} 个
              </span>
            </div>
            
            <div class="p-6">
              <div class="flex flex-col gap-3">
                <div 
                  v-for="(modelId, index) in selectedGroup.models" 
                  :key="modelId"
                  class="group flex items-center gap-4 p-3.5 rounded-lg border border-border/60 bg-background hover:border-primary/40 hover:shadow-sm transition-all"
                >
                  <div class="flex h-7 w-7 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground text-xs shrink-0 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                    {{ index + 1 }}
                  </div>
                  <div class="flex-1 font-mono text-sm font-medium text-foreground">{{ modelId }}</div>
                  <button class="opacity-0 group-hover:opacity-100 p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-all">
                    <span class="i-carbon-trash-can block"></span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div v-else class="flex h-full items-center justify-center text-muted-foreground">
        <div class="text-center">
          <div class="flex h-20 w-20 items-center justify-center rounded-full bg-muted/50 mx-auto mb-4">
            <span class="i-carbon-group-objects text-4xl text-muted-foreground/50"></span>
          </div>
          <p class="text-lg font-medium text-foreground">未选择分组</p>
          <p class="mt-2 text-sm">请在左侧选择一个模型分组进行查看或编辑</p>
        </div>
      </div>
    </div>
  </div>
</template>
