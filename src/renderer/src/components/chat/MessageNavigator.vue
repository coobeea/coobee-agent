<script setup lang="ts">
/**
 * MessageNavigator — 消息导航条
 *
 * 在聊天界面右侧显示消息定位标记（短线）
 * - 只显示用户消息
 * - 标记均匀分布在顶端
 * - 点击精确跳转到对应消息
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';

interface NavigatorMessage {
  id: string;
  role: 'user' | 'assistant';
}

const props = defineProps<{
  messages: NavigatorMessage[];
  containerRef: HTMLElement | null;
}>();

const hoveredIndex = ref<number | null>(null);
const currentIndex = ref<number>(0);

// 只显示用户消息
const userMessages = computed(() => {
  return props.messages.map((msg, originalIndex) => ({ msg, originalIndex })).filter(({ msg }) => msg.role === 'user');
});

// 获取消息颜色（统一使用 primary 颜色）
function getMessageColor(): string {
  return 'hsl(var(--primary))';
}

// 计算消息元素的位置
function getMessageElement(index: number): HTMLElement | null {
  if (!props.containerRef) return null;
  const messages = props.containerRef.querySelectorAll('.msg-block');
  return messages[index] as HTMLElement | null;
}

// 跳转到指定消息（修复定位准确性）
function scrollToMessage(originalIndex: number): void {
  if (!props.containerRef) return;

  const element = getMessageElement(originalIndex);
  if (!element) {
    console.warn('[MessageNavigator] 找不到消息元素，索引:', originalIndex);
    return;
  }

  // 使用容器的 scrollTo 方法，更精确
  const container = props.containerRef;
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  // 计算目标滚动位置：让消息居中显示
  const targetScrollTop =
    container.scrollTop + // 当前滚动位置
    (elementRect.top - containerRect.top) - // 元素相对容器顶部的距离
    containerRect.height / 2 + // 减去容器高度的一半
    elementRect.height / 2; // 加上元素高度的一半

  container.scrollTo({
    top: targetScrollTop,
    behavior: 'smooth'
  });
}

// 监听滚动更新当前位置
function updateCurrentPosition(): void {
  if (!props.containerRef || props.messages.length === 0) return;

  const containerRect = props.containerRef.getBoundingClientRect();
  const containerCenter = containerRect.top + containerRect.height / 2;

  let closestIndex = 0;
  let closestDistance = Infinity;

  props.messages.forEach((_, index) => {
    const element = getMessageElement(index);
    if (element) {
      const rect = element.getBoundingClientRect();
      const msgCenter = rect.top + rect.height / 2;
      const distance = Math.abs(msgCenter - containerCenter);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }
  });

  currentIndex.value = closestIndex;
}

// 滚动监听
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
function handleScroll(): void {
  if (scrollTimeout) clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    updateCurrentPosition();
  }, 100);
}

onMounted(() => {
  if (props.containerRef) {
    props.containerRef.addEventListener('scroll', handleScroll);
    updateCurrentPosition();
  }
});

onUnmounted(() => {
  if (props.containerRef) {
    props.containerRef.removeEventListener('scroll', handleScroll);
  }
  if (scrollTimeout) clearTimeout(scrollTimeout);
});

// 检查消息是否在视口中心附近（用于高亮当前位置）
function isMessageNearCenter(originalIndex: number): boolean {
  return Math.abs(originalIndex - currentIndex.value) <= 1;
}
</script>

<template>
  <div class="message-navigator">
    <!-- 导航条容器 -->
    <div class="navigator-track">
      <!-- 消息标记（只显示用户消息，均匀分布） -->
      <div
        v-for="{ msg, originalIndex } in userMessages"
        :key="msg.id"
        class="navigator-marker"
        :class="{
          'navigator-marker--active': isMessageNearCenter(originalIndex),
          'navigator-marker--hovered': originalIndex === hoveredIndex
        }"
        :style="{ backgroundColor: getMessageColor() }"
        @mouseenter="hoveredIndex = originalIndex"
        @mouseleave="hoveredIndex = null"
        @click="scrollToMessage(originalIndex)" />
    </div>
  </div>
</template>

<style scoped>
.message-navigator {
  position: absolute;
  top: 12px;
  right: 3px;
  bottom: 12px;
  width: 8px;
  pointer-events: none;
  z-index: 10;
}

.navigator-track {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 0;
}

.navigator-marker {
  position: relative;
  width: 100%;
  height: 3px;
  border-radius: 2px;
  opacity: 0.42;
  cursor: pointer;
  pointer-events: auto;
  transition: all 0.2s ease;
}

.navigator-marker:hover {
  opacity: 0.9;
  transform: scaleX(1.4);
  height: 4px;
}

.navigator-marker--active {
  opacity: 0.75;
  height: 5px;
}

.navigator-marker--hovered {
  opacity: 1;
  transform: scaleX(1.6);
  height: 5px;
}
</style>
