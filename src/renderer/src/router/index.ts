import { createRouter, createWebHashHistory } from 'vue-router';

// 标记是否已检查过引导状态（避免循环重定向）
let hasCheckedOnboarding = false;

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/welcome',
      name: 'welcome',
      component: () => import('@/views/WelcomeView.vue'),
      meta: { fullscreen: true }
    },
    {
      path: '/',
      component: () => import('@/layout/index.vue'),
      redirect: '/home',
      children: [
        {
          path: 'home',
          name: 'home',
          component: () => import('@/views/HomeView.vue')
        },
        {
          path: 'agents',
          name: 'agents',
          component: () => import('@/views/AgentView.vue')
        },
        {
          path: 'insight',
          name: 'insight',
          component: () => import('@/views/InsightView.vue')
        },
        {
          path: 'insight/session/:id',
          name: 'insight-session',
          component: () => import('@/views/InsightSessionView.vue')
        },
        {
          path: 'insight/templates/create',
          name: 'insight-template-create',
          component: () => import('@/views/InsightTemplateEditorView.vue')
        },
        {
          path: 'agents/create',
          name: 'agent-create',
          component: () => import('@/views/AgentEditorView.vue')
        },
        {
          path: 'agents/edit/:id',
          name: 'agent-edit',
          component: () => import('@/views/AgentEditorView.vue')
        },
        {
          path: 'thread/:id',
          name: 'thread',
          // 三栏布局备份：@/views/ThreadView.vue
          component: () => import('@/views/ThreadViewDual.vue')
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/SettingsView.vue')
        }
      ]
    }
  ]
});

// 路由守卫：检查引导状态
router.beforeEach(async (to) => {
  // 如果已经在欢迎页，直接放行
  if (to.path === '/welcome') {
    return true;
  }

  // 如果还没检查过引导状态，检查一次
  if (!hasCheckedOnboarding) {
    hasCheckedOnboarding = true;

    try {
      const completed = await window.api.onboarding.check();

      // 未完成引导，跳转到欢迎页
      if (!completed) {
        return '/welcome';
      }
    } catch (error) {
      console.error('检查引导状态失败:', error);
      // 发生错误时，仍然放行（避免阻塞用户）
    }
  }
  return true;
});

export default router;
