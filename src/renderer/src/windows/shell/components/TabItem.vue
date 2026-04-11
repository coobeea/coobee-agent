<script setup lang="ts">
import { ref } from 'vue';
import IconMdiClose from '~icons/mdi/close';

defineProps<{
  active: boolean;
  canClose: boolean;
}>();

const emit = defineEmits<{
  click: [];
  close: [];
}>();

const tabItem = ref<HTMLElement | null>(null);

const onClick = (): void => {
  emit('click');

  // 平滑滚动到可见区域
  setTimeout(() => {
    tabItem.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, 50);
};

const onClose = (): void => {
  emit('close');
};
</script>

<template>
  <div
    ref="tabItem"
    class="window-no-drag-region group relative flex h-full w-[160px] shrink min-w-[48px] max-w-[160px] cursor-pointer items-center justify-between px-2 text-xs font-medium transition-colors rounded-t-md"
    :class="[
      active
        ? 'bg-gray-50 text-gray-800' // 激活状态：与主内容区背景色一致，无缝衔接
        : 'text-gray-500 hover:bg-gray-200/80 hover:text-gray-700' // 未激活状态
    ]"
    @click="onClick">
    <!-- Tab Content -->
    <div class="flex flex-1 items-center overflow-hidden pr-1">
      <slot></slot>
    </div>

    <!-- Close Button -->
    <button
      v-if="canClose"
      type="button"
      class="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded transition-all"
      :class="[
        active
          ? 'text-gray-400 hover:bg-gray-200 hover:text-gray-800'
          : 'text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-gray-300 hover:text-gray-800'
      ]"
      @click.stop="onClose">
      <IconMdiClose class="text-[12px]" />
    </button>
  </div>
</template>

<style scoped>
.window-no-drag-region {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
</style>
