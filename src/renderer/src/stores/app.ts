import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useAppStore = defineStore(
  'app',
  () => {
    const version = ref('1.0.0');
    const isDark = ref(false);

    function toggleTheme() {
      isDark.value = !isDark.value;
    }

    return {
      version,
      isDark,
      toggleTheme
    };
  },
  {
    persist: true
  }
);
