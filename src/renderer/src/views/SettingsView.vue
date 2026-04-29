<script setup lang="ts">
/**
 * SettingsView — 设置页面容器
 *
 * 采用分组式设置导航，便于后续扩展外观、语言、语音等设置项。
 */

import { computed, markRaw, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ProviderSettings from './settings/ProviderSettings.vue';
import BasicSettings from './settings/BasicSettings.vue';
import WorkersSettings from './settings/WorkersSettings.vue';
import AboutView from './settings/AboutView.vue';

type MenuItem = {
  id: string;
  label: string;
  description: string;
  icon: string;
  component: ReturnType<typeof markRaw>;
};

type MenuGroup = {
  id: string;
  label: string;
  items: MenuItem[];
};

const menuGroups: MenuGroup[] = [
  {
    id: 'general',
    label: '通用',
    items: [
      {
        id: 'basic',
        label: '基本设置',
        description: '默认模型、应用偏好',
        icon: 'i-carbon-settings',
        component: markRaw(BasicSettings)
      }
    ]
  },
  {
    id: 'model',
    label: '智能能力',
    items: [
      {
        id: 'providers',
        label: '模型供应商',
        description: '连接、密钥、模型能力',
        icon: 'i-carbon-machine-learning-model',
        component: markRaw(ProviderSettings)
      },
      {
        id: 'workers',
        label: '内置服务',
        description: 'ASR、TTS、OCR',
        icon: 'i-carbon-server',
        component: markRaw(WorkersSettings)
      }
    ]
  },
  {
    id: 'system',
    label: '系统',
    items: [
      {
        id: 'about',
        label: '关于',
        description: '版本信息、项目说明',
        icon: 'i-carbon-information',
        component: markRaw(AboutView)
      }
    ]
  }
];

const route = useRoute();
const router = useRouter();
const menuItems = menuGroups.flatMap((group) => group.items);
const defaultMenuItem = menuItems[0] as MenuItem;

function isValidMenuId(menuId: unknown): menuId is string {
  return typeof menuId === 'string' && menuItems.some((item) => item.id === menuId);
}

const activeMenu = ref(isValidMenuId(route.query.section) ? route.query.section : defaultMenuItem.id);
const activeItem = computed(() => menuItems.find((item) => item.id === activeMenu.value) ?? defaultMenuItem);
const activeComponent = computed(() => activeItem.value.component);

function selectMenu(menuId: string): void {
  activeMenu.value = menuId;
  void router.replace({
    query: {
      ...route.query,
      section: menuId
    }
  });
}

watch(
  () => route.query.section,
  (section) => {
    if (isValidMenuId(section)) {
      activeMenu.value = section;
    }
  }
);
</script>

<template>
  <div class="flex h-full bg-background text-foreground">
    <aside
      class="flex w-[236px] shrink-0 flex-col border-r border-border/60 bg-surface/95 supports-[backdrop-filter]:bg-surface/90">
      <div class="border-b border-border/40 px-4 py-4">
        <div class="flex items-center gap-2.5">
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <span class="i-carbon-settings-adjust inline-block h-4 w-4"></span>
          </span>
          <div class="min-w-0">
            <h1 class="truncate text-sm font-semibold tracking-tight text-foreground">系统设置</h1>
            <p class="mt-0.5 text-[11px] leading-4 text-muted-foreground">配置全局行为与能力</p>
          </div>
        </div>
      </div>

      <nav class="flex-1 overflow-y-auto px-3 py-3">
        <div v-for="group in menuGroups" :key="group.id" class="mb-4 last:mb-0">
          <div class="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
            {{ group.label }}
          </div>

          <div class="grid gap-1">
            <button
              v-for="item in group.items"
              :key="item.id"
              :class="[
                'group relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors',
                activeMenu === item.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
              ]"
              type="button"
              @click="selectMenu(item.id)">
              <span
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors"
                :class="activeMenu === item.id ? 'bg-primary-foreground/15' : 'bg-background/70 group-hover:bg-muted'">
                <span :class="[item.icon, 'inline-block h-3.5 w-3.5']"></span>
              </span>

              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13px] font-semibold leading-5">
                  {{ item.label }}
                </span>
                <span
                  class="block truncate text-[11px] leading-4"
                  :class="activeMenu === item.id ? 'text-primary-foreground/72' : 'text-muted-foreground'">
                  {{ item.description }}
                </span>
              </span>
            </button>
          </div>
        </div>
      </nav>
    </aside>

    <section class="min-w-0 flex-1 overflow-hidden bg-background">
      <transition name="fade-slide" mode="out-in">
        <component :is="activeComponent" :key="activeItem.id" />
      </transition>
    </section>
  </div>
</template>

<style scoped>
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
