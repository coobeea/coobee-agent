# coobee-agent

一个基于 Electron + Vue 3 + TypeScript 的桌面应用程序

## ✨ 技术栈

- **Electron**: 跨平台桌面应用框架
- **Vue 3**: 渐进式 JavaScript 框架（使用 Composition API）
- **TypeScript**: 类型安全的 JavaScript 超集
- **Vite**: 现代化前端构建工具
- **electron-vite**: 专为 Electron 优化的 Vite 集成
- **electron-builder**: 应用打包和分发工具
- **electron-updater**: 自动更新功能

## 📁 项目结构

```
coobee-agent/
├── src/
│   ├── main/              # Electron 主进程代码（TypeScript）
│   │   └── index.ts       # 主进程入口文件
│   ├── preload/           # 预加载脚本（TypeScript）
│   │   └── index.ts       # 预加载脚本入口
│   └── renderer/          # 渲染进程（Vue 3 应用）
│       ├── src/
│       │   ├── components/  # Vue 组件
│       │   ├── App.vue      # 根组件
│       │   └── main.ts      # Vue 应用入口
│       └── index.html       # HTML 模板
├── resources/             # 应用资源文件
├── build/                 # 构建配置和图标
├── electron-builder.yml   # 打包配置
├── electron.vite.config.ts # Vite 配置
├── tsconfig.json          # TypeScript 配置
├── tsconfig.node.json     # Node.js TypeScript 配置
└── tsconfig.web.json      # Web TypeScript 配置
```

## 🛠 推荐 IDE 配置

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

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

## 🚀 特性

- ⚡️ 使用 Vite 实现快速热重载
- 🎨 Vue 3 Composition API + TypeScript
- 📦 开箱即用的 Electron 配置
- 🛠 集成 ESLint + Prettier
- 🔧 支持 IPC 通信（主进程与渲染进程）
- 📱 跨平台支持（Windows、macOS、Linux）
- 🔄 集成自动更新功能（electron-updater）
- 🔒 类型安全（TypeScript）
- 🎯 配置了国内镜像加速

## 📝 配置说明

### 项目选项

本项目在创建时选择了以下配置：

1. **TypeScript**: ✅ 已启用
   - 提供类型检查和更好的代码提示
   - 减少运行时错误

2. **Electron Updater**: ✅ 已启用
   - 支持应用自动更新
   - 配置文件：`dev-app-update.yml`（开发环境）

3. **镜像加速**: ✅ 已启用
   - 使用国内镜像加速依赖下载
   - 配置文件：`.npmrc`

## 📄 License

根据 LICENSE 文件授权
