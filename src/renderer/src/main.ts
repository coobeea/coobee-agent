import './assets/tailwind.css';
import './assets/main.css';

import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import ipcSetup from './plugins/ipcSetup';
import eventbusSetup from './plugins/eventbusSetup';
import gatewaySetup from './plugins/gatewaySetup';
import pinia from './stores';
import components from './components';
import directives from './directives';

// 创建 Vue 应用并注册插件
createApp(App)
  .use(pinia) // 1. Pinia 状态管理（必须最先注册，其他插件依赖 Store）
  .use(router) // 2. Vue Router 路由系统
  .use(components) // 3. 全局组件注册（Message, Confirm, Popup, Form 等）
  .use(directives) // 4. 自定义指令（v-focus, v-loading 等）
  .use(ipcSetup) // 5. IPC 事件监听（监听主进程事件，转发到 EventBus）
  .use(eventbusSetup) // 6. EventBus 初始化（注册事件处理器）
  .use(gatewaySetup) // 7. Gateway WebSocket 连接（等待后端就绪后自动连接）
  .mount('#app'); // 挂载到 #app 元素
