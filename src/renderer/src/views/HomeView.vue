<script setup lang="ts">
import { ref } from 'vue';

const message = ref('');
const result = ref('');
const loading = ref(false);

async function testAgent() {
  if (!message.value.trim()) return;
  
  loading.value = true;
  result.value = '正在思考...';
  
  try {
    const res = await window.api.agent.submit({
      sessionId: 'test-session-1',
      message: message.value
    });
    result.value = JSON.stringify(res, null, 2);
  } catch (err: any) {
    result.value = `Error: ${err.message}`;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center p-8 bg-background text-foreground">
    <div class="text-center w-full max-w-2xl">
      <h1 class="mb-4 text-3xl font-bold tracking-tight">Coobee Agent</h1>
      <p class="text-base text-muted-foreground mb-8">基础架构已就绪</p>
      
      <div class="flex flex-col gap-4 text-left">
        <textarea 
          v-model="message" 
          class="w-full h-24 p-3 border border-input bg-background rounded-md focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
          placeholder="输入测试消息，例如: 'Hello, who are you?'"
        ></textarea>
        
        <button 
          @click="testAgent" 
          :disabled="loading"
          class="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed self-end font-medium shadow-sm transition-colors"
        >
          {{ loading ? '执行中...' : '测试 Agent' }}
        </button>
        
        <div v-if="result" class="mt-4 p-4 bg-muted/50 rounded-md border border-border overflow-auto max-h-64">
          <pre class="text-sm whitespace-pre-wrap text-foreground">{{ result }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
