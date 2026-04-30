/**
 * 自定义指令导出
 *
 * 已注册指令：
 *   - v-ai-polish：输入框 Ctrl 长按 AI 润色
 */

import type { App } from 'vue';
import { aiPolish } from './aiPolish';

export default {
  install(app: App) {
    app.directive('ai-polish', aiPolish);
  }
};

export { aiPolish };
