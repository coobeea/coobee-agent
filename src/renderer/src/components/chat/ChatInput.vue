<script setup lang="ts">
/**
 * ChatInput — 对话输入组件
 *
 * 提供消息输入、文件引用等功能
 */

import { ref } from 'vue';

defineProps<{
  disabled?: boolean;
  placeholder?: string;
}>();

const emit = defineEmits<{
  send: [data: { text: string; files?: Array<{ path: string; name: string }> }];
  stop: [];
}>();

const inputText = ref('');
const files = ref<Array<{ path: string; name: string }>>([]);

function handleSend(): void {
  const text = inputText.value.trim();
  if (!text) return;

  emit('send', {
    text,
    files: files.value.length > 0 ? [...files.value] : undefined
  });

  inputText.value = '';
  files.value = [];
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
}

function insertFileReference(file: { path: string; name: string }): void {
  if (!files.value.find((f) => f.path === file.path)) {
    files.value.push(file);
  }
}

function removeFile(index: number): void {
  files.value.splice(index, 1);
}

defineExpose({
  insertFileReference
});
</script>

<template>
  <div class="chat-input-container">
    <!-- 文件引用列表 -->
    <div v-if="files.length > 0" class="file-refs">
      <div v-for="(file, index) in files" :key="file.path" class="file-ref-item">
        <span class="i-carbon-document inline-block h-3 w-3" />
        <span class="file-ref-name">{{ file.name }}</span>
        <button class="file-ref-remove" @click="removeFile(index)">
          <span class="i-carbon-close inline-block h-3 w-3" />
        </button>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="input-wrapper">
      <textarea
        v-model="inputText"
        class="chat-input"
        :placeholder="placeholder || '输入消息...'"
        :disabled="disabled"
        @keydown="handleKeydown" />
      
      <button
        class="send-btn"
        :disabled="!inputText.trim() || disabled"
        @click="handleSend">
        <span class="i-carbon-send-alt inline-block h-4 w-4" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-input-container {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border-top: 1px solid hsl(var(--border) / 0.2);
  background: hsl(var(--surface) / 0.6);
}

.file-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid hsl(var(--border) / 0.15);
}

.file-ref-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  background: hsl(var(--muted) / 0.3);
  color: hsl(var(--foreground) / 0.7);
  font-size: 12px;
  border: 1px solid hsl(var(--border) / 0.3);
}

.file-ref-name {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-ref-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border-radius: 3px;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: all 0.1s ease;
}

.file-ref-remove:hover {
  background: hsl(var(--error) / 0.1);
  color: hsl(var(--error));
}

.input-wrapper {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
}

.chat-input {
  flex: 1;
  min-height: 36px;
  max-height: 120px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border) / 0.4);
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  transition: all 0.15s ease;
}

.chat-input:focus {
  border-color: hsl(var(--primary));
  outline: none;
  box-shadow: 0 0 0 1px hsl(var(--primary) / 0.2);
}

.chat-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  background: hsl(var(--primary-hover));
  box-shadow: 0 2px 8px hsl(var(--primary) / 0.3);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
