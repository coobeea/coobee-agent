import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
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
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/SettingsView.vue')
        }
      ]
    }
  ]
});

export default router;
