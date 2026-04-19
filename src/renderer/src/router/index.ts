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
          component: () => import('@/views/ThreadView.vue')
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
router.beforeEach(async (to, from, next) => {
  // 如果已经在欢迎页，直接放行
  if (to.path === '/welcome') {
    next();
    return;
  }

  // 如果还没检查过引导状态，检查一次
  if (!hasCheckedOnboarding) {
    hasCheckedOnboarding = true;

    try {
      const completed = await window.api.onboarding.check();

      // 未完成引导，跳转到欢迎页
      if (!completed) {
        next('/welcome');
        return;
      }
    } catch (error) {
      console.error('检查引导状态失败:', error);
      // 发生错误时，仍然放行（避免阻塞用户）
    }
  }

  next();
});

export default router;
