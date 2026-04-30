<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import type { ChatMessage } from '../ChatMessages.vue';

const props = defineProps<{
  message: ChatMessage;
}>();

const textRef = ref<HTMLElement | null>(null);
const isCollapsed = ref(true);
const isOverflowing = ref(false);

async function measureOverflow(): Promise<void> {
  await nextTick();
  const el = textRef.value;
  if (!el) return;

  isOverflowing.value = el.scrollHeight > el.clientHeight + 1;
}

function toggleCollapse(): void {
  isCollapsed.value = !isCollapsed.value;
}

onMounted(() => {
  void measureOverflow();
});

watch(
  () => props.message.content,
  () => {
    isCollapsed.value = true;
    void measureOverflow();
  }
);
</script>

<template>
  <div class="msg-block msg-block--user">
    <div class="msg-user-bubble">
      <div
        ref="textRef"
        class="msg-text"
        :class="{
          'msg-text--collapsed': isCollapsed,
          'msg-text--fade': isCollapsed && isOverflowing,
          'msg-text--expanded-scroll': !isCollapsed && isOverflowing
        }">
        {{ message.content }}
      </div>
      <button v-if="isOverflowing" type="button" class="msg-toggle" @click="toggleCollapse">
        {{ isCollapsed ? '展开' : '收起' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 消息块 */
.msg-block {
  padding: 5px 12px;
}

.msg-block--user {
  padding-top: 6px;
  padding-bottom: 6px;
}

.msg-user-bubble {
  width: calc(100% + 20px);
  margin-left: -10px;
  margin-right: -10px;
  padding: 7px 10px;
  border: 1px solid hsl(var(--primary) / 0.16);
  border-radius: 7px;
  background: hsl(var(--primary) / 0.075);
}

.msg-text {
  position: relative;
  font-size: 13.5px;
  line-height: 1.55;
  color: hsl(var(--foreground));
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-text--collapsed {
  max-height: calc(1.55em * 4);
  overflow: hidden;
}

.msg-text--expanded-scroll {
  max-height: calc(1.55em * 12);
  overflow-y: auto;
  padding-right: 6px;
}

.msg-text--fade::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1.8em;
  background: linear-gradient(to bottom, hsl(var(--primary) / 0), hsl(var(--primary) / 0.075) 78%);
  pointer-events: none;
}

.msg-toggle {
  margin-top: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: hsl(var(--primary) / 0.78);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  cursor: pointer;
}

.msg-toggle:hover {
  color: hsl(var(--primary));
}
</style>
