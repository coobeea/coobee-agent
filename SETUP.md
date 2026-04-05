# 项目配置总结

## 📦 已添加的依赖

### 生产依赖 (dependencies)

#### 状态管理与路由
- `pinia` (3.0.4) - Vue 官方状态管理库
- `pinia-plugin-persistedstate` (4.7.1) - 状态持久化插件
- `vue-router` (5.0.2) - 官方路由管理器

#### Vue 工具集
- `@vueuse/core` (14.2.0) - Vue Composition API 工具集

#### HTTP 与数据处理
- `axios` (1.13.4) - HTTP 客户端
- `zod` (4.3.6) - TypeScript 数据验证库

#### 工具库
- `dayjs` (1.11.19) - 轻量级日期处理库
- `lodash` (4.17.23) - JavaScript 实用工具库
- `nanoid` (5.1.6) - 轻量级唯一 ID 生成器
- `mitt` (3.0.1) - 轻量级事件总线（200 bytes）

#### Electron 增强
- `electron-log` (5.4.3) - 日志管理
- `electron-store` (8.2.0) - 本地数据存储
- `electron-window-state` (5.0.3) - 窗口状态管理
- `electron-updater` (6.3.9) - 自动更新功能

#### UI 与通知
- `vue-sonner` (2.0.9) - 现代化 Toast 通知组件

### 开发依赖 (devDependencies)

#### Tailwind CSS
- `tailwindcss` (4.1.18) - 原子化 CSS 框架
- `@tailwindcss/vite` (4.1.18) - Vite 集成插件
- `@tailwindcss/typography` (0.5.19) - 排版样式插件

#### 图标系统
- `unplugin-icons` (23.0.1) - 按需导入图标
- `@egoist/tailwindcss-icons` (1.9.2) - Tailwind CSS 图标集成
- `@iconify-json/carbon` (1.2.18) - Carbon 图标集
- `@iconify-json/heroicons` (1.2.3) - Heroicons 图标集
- `@iconify-json/mdi` (1.2.3) - Material Design Icons
- `@iconify-json/svg-spinners` (1.2.4) - 加载动画图标

#### 组件自动导入
- `unplugin-vue-components` (31.0.0) - Vue 组件自动导入

#### 测试框架
- `vitest` (4.0.18) - 现代化测试框架
- `@vitest/coverage-v8` (4.0.18) - 测试覆盖率工具

#### 代码质量
- `lint-staged` (16.2.7) - Git 提交前代码检查
- `simple-git-hooks` (2.13.1) - Git 钩子管理
- `cross-env` (10.1.0) - 跨平台环境变量设置

#### 类型定义
- `@types/lodash` (4.17.0) - Lodash 类型定义

#### 样式工具
- `sass` (1.97.3) - CSS 预处理器

#### 开发工具
- `electron-devtools-installer` (4.0.0) - 安装 Chrome DevTools 扩展

## 🗂️ 新增的目录结构

```
src/
├── shared/                       # 共享代码（主进程与渲染进程）
│   ├── types.ts                 # 共享类型定义
│   └── constants.ts             # 共享常量
└── renderer/src/
    ├── composables/             # Composition API
    │   ├── useIpc.ts           # IPC 通信封装
    │   └── useEventBus.ts      # 事件总线
    ├── router/                  # 路由配置
    │   └── index.ts            # 路由定义
    ├── stores/                  # Pinia 状态管理
    │   └── app.ts              # 应用状态
    ├── styles/                  # 样式文件
    │   └── tailwind.css        # Tailwind CSS 入口
    ├── types/                   # 类型定义
    │   └── components.d.ts     # 组件类型（自动生成）
    ├── utils/                   # 工具函数
    │   └── index.ts            # 通用工具
    └── views/                   # 页面视图
        └── Home.vue            # 首页
```

## ⚙️ 新增的配置文件

### 1. `vitest.config.ts`
Vitest 测试框架配置

### 2. `electron.vite.config.ts` (已更新)
新增功能：
- Tailwind CSS 集成
- 图标自动导入
- 组件自动导入
- 路径别名配置
- 优化依赖预构建

### 3. `tsconfig.web.json` (已更新)
新增路径别名：
- `@/*` → `src/renderer/src/*`
- `@renderer/*` → `src/renderer/src/*`
- `@shared/*` → `src/shared/*`

### 4. `package.json` (已更新)
新增脚本：
- `test` - 运行测试
- `test:watch` - 监听模式测试
- `test:coverage` - 生成覆盖率报告

新增 Git Hooks 配置：
- `pre-commit` - 提交前自动格式化代码
- `lint-staged` - 分阶段 lint 检查

## 🎯 核心功能

### 1. 状态管理（Pinia）
```typescript
// src/renderer/src/stores/app.ts
import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', () => {
  const version = ref('1.0.0')
  const isDark = ref(false)
  
  function toggleTheme() {
    isDark.value = !isDark.value
  }
  
  return { version, isDark, toggleTheme }
}, {
  persist: true  // 自动持久化
})
```

### 2. 路由管理（Vue Router）
```typescript
// src/renderer/src/router/index.ts
import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [...]
})
```

### 3. IPC 通信封装
```typescript
// src/renderer/src/composables/useIpc.ts
const { loading, error, send, invoke, on } = useIpc()

// 发送消息
send('channel-name', data)

// 调用方法
const result = await invoke('channel-name', data)

// 监听消息
const unsubscribe = on('channel-name', (data) => {
  console.log(data)
})
```

### 4. 事件总线
```typescript
// src/renderer/src/composables/useEventBus.ts
const { emit, on, once, off } = useEventBus()

// 发送事件
emit('event-name', data)

// 监听事件
on('event-name', (data) => {
  console.log(data)
})
```

### 5. 工具函数
```typescript
// src/renderer/src/utils/index.ts
import { formatDate, generateId, sleep, debounce, throttle } from '@/utils'

// 格式化日期
const date = formatDate(new Date(), 'YYYY-MM-DD')

// 生成唯一 ID
const id = generateId()

// 延迟执行
await sleep(1000)

// 防抖
const debouncedFn = debounce(fn, 300)

// 节流
const throttledFn = throttle(fn, 1000)
```

## 🎨 样式系统

### Tailwind CSS v4
项目已集成 Tailwind CSS v4，支持：
- 原子化 CSS 类
- 响应式设计
- 暗黑模式
- 排版样式（@tailwindcss/typography）

### 图标系统
使用 `unplugin-icons` 按需导入图标：

```vue
<template>
  <!-- 自动导入图标组件 -->
  <icon-mdi-home />
  <icon-heroicons-user />
  <icon-carbon-settings />
</template>
```

## 🧪 测试

### Vitest 配置
```bash
# 运行测试
pnpm test

# 监听模式
pnpm test:watch

# 覆盖率报告
pnpm test:coverage
```

### 测试文件位置
- `src/**/__tests__/**/*.test.ts`
- `src/**/*.test.ts`

## 🪝 Git Hooks

### 提交前自动检查
使用 `simple-git-hooks` + `lint-staged` 实现提交前代码检查：

- ✅ 自动格式化代码（Prettier）
- ✅ 自动 lint 检查（ESLint）
- ✅ 仅检查暂存区文件

### 初始化 Git Hooks
```bash
# 安装依赖后会自动初始化
pnpm install
```

## 📝 类型安全

### 路径别名类型支持
所有路径别名都配置了 TypeScript 支持：
- `@/*` - 渲染进程代码
- `@renderer/*` - 渲染进程代码
- `@shared/*` - 共享代码
- `@main/*` - 主进程代码

### 组件类型自动生成
`unplugin-vue-components` 会自动生成组件类型定义：
- 文件：`src/renderer/src/types/components.d.ts`
- 自动识别导入的组件

## 🚀 快速开始

### 1. 安装依赖
```bash
pnpm install
```

### 2. 启动开发
```bash
pnpm dev
```

### 3. 类型检查
```bash
pnpm typecheck
```

### 4. 运行测试
```bash
pnpm test
```

### 5. 构建打包
```bash
pnpm build:mac  # macOS
pnpm build:win  # Windows
pnpm build:linux  # Linux
```

## 📚 参考文档

- [Electron](https://www.electronjs.org/)
- [Vue 3](https://vuejs.org/)
- [Pinia](https://pinia.vuejs.org/)
- [Vue Router](https://router.vuejs.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Vite](https://vitejs.dev/)
- [Vitest](https://vitest.dev/)
- [VueUse](https://vueuse.org/)
- [Iconify](https://iconify.design/)

## 🎉 完成！

项目基础依赖配置完成，现在可以开始开发了！
