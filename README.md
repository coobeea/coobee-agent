# coobee-agent

一个基于 Electron + Vue 3 + TypeScript 的现代化桌面应用程序

## ✨ 技术栈

### 核心框架
- **Electron**: 跨平台桌面应用框架
- **Vue 3**: 渐进式 JavaScript 框架（使用 Composition API）
- **TypeScript**: 类型安全的 JavaScript 超集
- **Vite**: 现代化前端构建工具
- **electron-vite**: 专为 Electron 优化的 Vite 集成

### UI 与样式
- **Tailwind CSS v4**: 原子化 CSS 框架
- **@tailwindcss/typography**: 优雅的排版样式
- **Sass**: CSS 预处理器
- **unplugin-icons**: 按需导入图标组件
- **@iconify**: 统一的图标解决方案

### 状态管理与路由
- **Pinia**: Vue 官方状态管理库
- **pinia-plugin-persistedstate**: 状态持久化插件
- **Vue Router**: 官方路由管理器
- **@vueuse/core**: Vue Composition API 工具集

### 工具库
- **axios**: HTTP 客户端
- **dayjs**: 轻量级日期处理库
- **lodash**: JavaScript 实用工具库
- **nanoid**: 轻量级唯一 ID 生成器
- **mitt**: 轻量级事件总线
- **zod**: TypeScript 优先的数据验证库

### Electron 增强
- **electron-log**: 日志管理
- **electron-store**: 本地数据存储
- **electron-updater**: 自动更新功能
- **electron-window-state**: 窗口状态管理

### 开发工具
- **Vitest**: 现代化测试框架
- **ESLint**: 代码质量检查
- **Prettier**: 代码格式化
- **lint-staged**: Git 提交前代码检查
- **simple-git-hooks**: Git 钩子管理
- **cross-env**: 跨平台环境变量设置

## 📁 项目结构

```
coobee-agent/
├── src/
│   ├── main/              # Electron 主进程（TypeScript）
│   │   └── index.ts       # 主进程入口
│   ├── preload/           # 预加载脚本（TypeScript）
│   │   ├── index.ts       # 预加载入口
│   │   └── index.d.ts     # 类型定义
│   ├── renderer/          # 渲染进程（Vue 3）
│   │   ├── src/
│   │   │   ├── assets/        # 静态资源
│   │   │   ├── components/    # Vue 组件
│   │   │   ├── composables/   # Composition API
│   │   │   ├── router/        # 路由配置
│   │   │   ├── stores/        # Pinia 状态管理
│   │   │   ├── styles/        # 样式文件
│   │   │   ├── types/         # 类型定义
│   │   │   ├── utils/         # 工具函数
│   │   │   ├── views/         # 页面视图
│   │   │   ├── App.vue        # 根组件
│   │   │   └── main.ts        # 应用入口
│   │   └── index.html         # HTML 模板
│   └── shared/            # 共享代码（主进程与渲染进程）
│       ├── types.ts       # 共享类型
│       └── constants.ts   # 共享常量
├── resources/             # 应用资源文件
├── build/                 # 构建配置和图标
├── electron-builder.yml   # 打包配置
├── electron.vite.config.ts # Vite 配置
├── vitest.config.ts       # Vitest 配置
├── tsconfig.json          # TypeScript 配置
└── package.json           # 项目配置
```

## 🛠 推荐 IDE 配置

- [VSCode](https://code.visualstudio.com/)
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)
- [Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)

## 📦 开发指南

### 安装依赖

```bash
pnpm install
```

### 开发模式

启动开发服务器，支持热重载：

```bash
pnpm dev
```

### 类型检查

```bash
# 检查所有 TypeScript 类型
pnpm typecheck

# 仅检查 Node.js 代码（主进程/预加载）
pnpm typecheck:node

# 仅检查 Web 代码（渲染进程）
pnpm typecheck:web
```

### 测试

```bash
# 运行测试
pnpm test

# 监听模式
pnpm test:watch

# 生成覆盖率报告
pnpm test:coverage
```

### 代码规范

```bash
# 代码格式化
pnpm format

# ESLint 检查
pnpm lint
```

### 构建打包

```bash
# Windows 平台
pnpm build:win

# macOS 平台
pnpm build:mac

# Linux 平台
pnpm build:linux

# 构建但不打包（用于调试）
pnpm build:unpack
```

## 🚀 核心特性

### 前端特性
- ⚡️ 使用 Vite 实现快速热重载
- 🎨 Vue 3 Composition API + TypeScript
- 🎯 Tailwind CSS v4 原子化样式
- 📦 组件自动导入（unplugin-vue-components）
- 🎭 图标按需加载（unplugin-icons）
- 🌗 暗黑模式支持
- 🔄 Pinia 状态管理 + 持久化
- 🛣️ Vue Router 路由管理

### 后端特性
- 🔧 IPC 通信（主进程与渲染进程）
- 📝 日志管理（electron-log）
- 💾 本地存储（electron-store）
- 🪟 窗口状态管理（electron-window-state）
- 🔄 自动更新功能（electron-updater）

### 开发体验
- 📱 跨平台支持（Windows、macOS、Linux）
- 🔒 TypeScript 类型安全
- ✅ Vitest 单元测试
- 🎯 ESLint + Prettier 代码规范
- 🪝 Git Hooks 提交前检查
- 🚀 国内镜像加速

## 🎨 内置工具

### Composables
- `useIpc()` - IPC 通信封装
- `useEventBus()` - 事件总线
- `useAppStore()` - 应用状态管理

### 工具函数
- `formatDate()` - 日期格式化
- `generateId()` - 生成唯一 ID
- `sleep()` - 延迟函数
- `debounce()` - 防抖函数
- `throttle()` - 节流函数

## 📝 配置说明

### 项目选项

1. **TypeScript**: ✅ 已启用
   - 提供类型检查和更好的代码提示
   - 减少运行时错误

2. **Electron Updater**: ✅ 已启用
   - 支持应用自动更新
   - 配置文件：`dev-app-update.yml`

3. **镜像加速**: ✅ 已启用
   - 使用国内镜像加速依赖下载
   - 配置文件：`.npmrc`

4. **Git Hooks**: ✅ 已配置
   - 提交前自动格式化和检查代码
   - 使用 `simple-git-hooks` + `lint-staged`

## 📄 License

根据 LICENSE 文件授权
