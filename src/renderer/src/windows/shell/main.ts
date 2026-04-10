import '@/assets/tailwind.css';
import '@/assets/main.css';

console.log('[Shell] main.ts loaded!');

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ShellApp from './ShellApp.vue';

// 创建 Vue 应用
const app = createApp(ShellApp);
console.log('[Shell] App created!');

app.config.errorHandler = (err, vm, info) => {
  console.error('[Shell] Vue Global Error:', err, info);
};

window.addEventListener('error', (event) => {
  console.error('[Shell] Global Error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Shell] Unhandled Promise Rejection:', event.reason);
});

// 创建 Pinia 实例
const pinia = createPinia();

app.use(pinia);

// 挂载到 DOM
app.mount('#app');
console.log('[Shell] App mounted!');
