import './assets/tailwind.css';
import './assets/main.css';

import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import eventbusSetup from './plugins/eventbusSetup';
import pinia from './stores';
import directives from './directives';

// 创建基础应用
createApp(App).use(pinia).use(router).use(directives).use(eventbusSetup).mount('#app');
