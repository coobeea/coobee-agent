<script setup lang="ts">
import { useAppStore } from '@/stores/app'
import { watch } from 'vue'

const appStore = useAppStore()

// 监听主题变化
watch(
  () => appStore.isDark,
  (isDark) => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  },
  { immediate: true }
)
</script>

<template>
  <router-view />
</template>
