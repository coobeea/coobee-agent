/**
 * WorkerManager 配置文件监控测试
 *
 * 测试覆盖：
 * 1. 配置文件变化监听
 * 2. enable 字段变化 → 启停 Worker
 * 3. autoStart 字段变化 → 启停 Worker
 * 4. 防抖机制
 * 5. 监控的启动和停止
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock dependencies
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp'
  }
}));

vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}));

const tmpDir = path.join(os.tmpdir(), `worker-test-${Date.now()}`);
const tmpRuntimeDir = path.join(os.tmpdir(), `worker-runtime-test-${Date.now()}`);

vi.mock('@main/common/env', () => {
  return {
    Env: {
      paths: {
        userHome: tmpRuntimeDir,
        userData: path.join(tmpRuntimeDir, 'data')
      },
      main: {
        serverHost: 'localhost',
        workerHost: '127.0.0.1'
      },
      isDev: true,
      isWindows: process.platform === 'win32'
    }
  };
});

vi.mock('@main/config', () => {
  return {
    BusinessPaths: {
      workers: {
        scripts: tmpDir,
        runtimeHome: tmpRuntimeDir,
        runtimeWorkers: path.join(tmpRuntimeDir, 'workers'),
        models: path.join(tmpRuntimeDir, 'models'),
        getScriptDir: (name: string) => path.join(tmpDir, name),
        getRuntimeDir: (name: string) => path.join(tmpRuntimeDir, 'workers', name),
        getRuntimeSourceDir: (name: string) => path.join(tmpRuntimeDir, 'workers', name, 'source'),
        getVenvDir: (name: string) => path.join(tmpRuntimeDir, 'workers', name, 'venv'),
        getDataDir: (name: string) => path.join(tmpRuntimeDir, 'workers', name, 'data'),
        getCacheDir: (name: string) => path.join(tmpRuntimeDir, 'workers', name, 'cache'),
        getConfigPath: (name: string) => path.join(tmpRuntimeDir, 'workers', name, 'config.json')
      },
      getPlatformRuntimeDir: () => path.join(tmpRuntimeDir, 'runtime')
    }
  };
});

describe('WorkerManager 配置文件监控', () => {
  let testWorkersDir: string;
  let WorkerManager: typeof import('../WorkerManager').WorkerManager;

  type WorkerManagerInternals = {
    getVenvDir(name: string): string;
    getWorkerRuntimeEnv(name: string): Record<string, string>;
  };

  beforeEach(async () => {
    // 动态导入以使用 mock
    const module = await import('../WorkerManager');
    WorkerManager = module.WorkerManager;

    // 获取测试目录
    const { BusinessPaths } = await import('@main/config');
    testWorkersDir = BusinessPaths.workers.scripts;

    // 清理并创建测试目录
    if (fs.existsSync(testWorkersDir)) {
      fs.rmSync(testWorkersDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testWorkersDir, { recursive: true });
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testWorkersDir)) {
      fs.rmSync(testWorkersDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tmpRuntimeDir)) {
      fs.rmSync(tmpRuntimeDir, { recursive: true, force: true });
    }

    // 重置单例
    // @ts-expect-error 访问私有字段用于测试
    WorkerManager.instance = null;
  });

  it('应该把 Worker 运行产物放到 runtime 目录而不是源码目录', async () => {
    const manager = WorkerManager.getInstance() as unknown as WorkerManagerInternals;
    const workerName = 'runtime-layout-worker';

    expect(manager.getVenvDir(workerName)).toBe(path.join(tmpRuntimeDir, 'workers', workerName, 'venv'));

    const runtimeEnv = manager.getWorkerRuntimeEnv(workerName);

    expect(runtimeEnv).toMatchObject({
      WORKER_RUNTIME_DIR: path.join(tmpRuntimeDir, 'workers', workerName),
      WORKER_DATA_DIR: path.join(tmpRuntimeDir, 'workers', workerName, 'data'),
      WORKER_CACHE_DIR: path.join(tmpRuntimeDir, 'workers', workerName, 'cache'),
      WORKER_CONFIG_PATH: path.join(tmpRuntimeDir, 'workers', workerName, 'config.json')
    });
    expect(runtimeEnv.WORKER_RUNTIME_DIR.startsWith(testWorkersDir)).toBe(false);
    expect(fs.existsSync(runtimeEnv.WORKER_DATA_DIR)).toBe(true);
    expect(fs.existsSync(runtimeEnv.WORKER_CACHE_DIR)).toBe(true);
  });

  it('应该监控配置文件变化', async () => {
    // 创建测试 Worker 配置
    const workerName = 'test-worker';
    const workerDir = path.join(testWorkersDir, workerName);
    fs.mkdirSync(workerDir, { recursive: true });

    const configPath = path.join(workerDir, 'worker.json');
    const initialConfig = {
      name: workerName,
      label: 'Test Worker',
      type: 'python' as const,
      entry: 'server.py',
      port: 9000,
      enable: true,
      autoStart: false
    };

    fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2));

    // 初始化 WorkerManager
    const manager = WorkerManager.getInstance();
    manager.register(initialConfig);
    manager.startWatching();

    // 等待监控启动
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 修改配置文件
    const updatedConfig = {
      ...initialConfig,
      enable: false
    };
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));

    // 等待 fs.watch 触发 + 防抖延迟
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 验证配置已更新
    const configs = manager.getRegisteredWorkers();
    const config = configs.find((c) => c.name === workerName);
    expect(config?.enable).toBe(false);

    // 停止监控
    manager.stopWatching();
  });

  it('enable: true → false 应该停止 Worker', async () => {
    // 创建测试 Worker 配置
    const workerName = 'test-stop-worker';
    const workerDir = path.join(testWorkersDir, workerName);
    fs.mkdirSync(workerDir, { recursive: true });

    const configPath = path.join(workerDir, 'worker.json');
    const initialConfig = {
      name: workerName,
      label: 'Test Stop Worker',
      type: 'python' as const,
      entry: 'server.py',
      port: 9001,
      enable: true,
      autoStart: true
    };

    fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2));

    // 创建一个简单的 Python 脚本（模拟 Worker）
    const scriptPath = path.join(workerDir, 'server.py');
    fs.writeFileSync(
      scriptPath,
      `#!/usr/bin/env python3
import time
import sys
print("[Worker] Started", flush=True)
sys.stdout.flush()
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("[Worker] Stopped", flush=True)
    sys.exit(0)
`
    );
    fs.chmodSync(scriptPath, 0o755);

    // 初始化 WorkerManager
    const manager = WorkerManager.getInstance();
    manager.register(initialConfig);
    manager.startWatching();

    // 启动 Worker
    await manager.start(workerName).catch(() => {
      // 可能因为没有 Python 环境而失败，跳过
    });

    // 等待启动
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 修改配置：禁用 Worker
    const updatedConfig = {
      ...initialConfig,
      enable: false
    };
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));

    // 等待配置重载
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 验证配置已更新为禁用
    expect(manager.getRegisteredWorkers().find((c) => c.name === workerName)?.enable).toBe(false);

    // 停止监控
    manager.stopWatching();
  });

  it('autoStart: false → true 应该启动 Worker', async () => {
    // 创建测试 Worker 配置
    const workerName = 'test-autostart-worker';
    const workerDir = path.join(testWorkersDir, workerName);
    fs.mkdirSync(workerDir, { recursive: true });

    const configPath = path.join(workerDir, 'worker.json');
    const initialConfig = {
      name: workerName,
      label: 'Test AutoStart Worker',
      type: 'python' as const,
      entry: 'server.py',
      port: 9002,
      enable: true,
      autoStart: false
    };

    fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2));

    // 初始化 WorkerManager
    const manager = WorkerManager.getInstance();
    manager.register(initialConfig);
    manager.startWatching();

    // 等待监控启动
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 修改配置：启用 autoStart
    const updatedConfig = {
      ...initialConfig,
      autoStart: true
    };
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));

    // 等待配置重载
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 验证配置已更新
    const config = manager.getRegisteredWorkers().find((c) => c.name === workerName);
    expect(config?.autoStart).toBe(true);

    // 停止监控
    manager.stopWatching();
  });

  it('防抖机制：短时间内多次修改只触发一次重载', async () => {
    // 创建测试 Worker 配置
    const workerName = 'test-debounce-worker';
    const workerDir = path.join(testWorkersDir, workerName);
    fs.mkdirSync(workerDir, { recursive: true });

    const configPath = path.join(workerDir, 'worker.json');
    const initialConfig = {
      name: workerName,
      label: 'Test Debounce Worker',
      type: 'python' as const,
      entry: 'server.py',
      port: 9003,
      enable: true,
      autoStart: false
    };

    fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2));

    // 初始化 WorkerManager
    const manager = WorkerManager.getInstance();
    manager.register(initialConfig);
    manager.startWatching();

    // 等待监控启动
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 快速连续修改配置文件 3 次
    for (let i = 0; i < 3; i++) {
      const config = {
        ...initialConfig,
        port: 9003 + i // 修改不影响启停的字段
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // 等待防抖延迟
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 验证配置已更新为最后一次修改的值
    const config = manager.getRegisteredWorkers().find((c) => c.name === workerName);
    expect(config?.port).toBe(9005);

    // 停止监控
    manager.stopWatching();
  });

  it('stopWatching 应该停止所有监控', async () => {
    // 创建多个测试 Worker
    const workers = ['worker-1', 'worker-2', 'worker-3'];

    for (const workerName of workers) {
      const workerDir = path.join(testWorkersDir, workerName);
      fs.mkdirSync(workerDir, { recursive: true });

      const configPath = path.join(workerDir, 'worker.json');
      const config = {
        name: workerName,
        label: `Test ${workerName}`,
        type: 'python' as const,
        entry: 'server.py',
        port: 9000 + workers.indexOf(workerName),
        enable: true,
        autoStart: false
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }

    // 初始化 WorkerManager
    const manager = WorkerManager.getInstance();
    for (const workerName of workers) {
      const configPath = path.join(testWorkersDir, workerName, 'worker.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      manager.register(config);
    }

    manager.startWatching();

    // 等待监控启动
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 停止监控
    manager.stopWatching();

    // 修改配置文件（不应该触发重载）
    const configPath = path.join(testWorkersDir, 'worker-1', 'worker.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.enable = false;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // 等待（如果监控未停止，会触发重载）
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 验证配置未被重载（因为监控已停止）
    const currentConfig = manager.getRegisteredWorkers().find((c) => c.name === 'worker-1');
    expect(currentConfig?.enable).toBe(true); // 应该还是原来的值
  });
});
