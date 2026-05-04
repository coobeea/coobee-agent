/**
 * Worker RPC 方法组
 *
 * 提供内置 Worker 的状态查询、启停和运行时配置管理。
 */

import fs from 'node:fs';
import path from 'node:path';

import { GatewayErrorCode, GatewayMethodError } from '@main/common/gateway/errors';
import type { MethodGroup } from '@main/common/gateway/types';
import { Env } from '@main/common/env';
import { createLogger } from '@main/common/logger';
import { WorkerManager } from '@main/common/worker';
import type { WorkerConfig, WorkerInfo } from '@main/common/worker/types';
import { BusinessPaths } from '@main/config';

const log = createLogger('worker-methods');

const WORKER_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const SENSITIVE_KEYS = new Set(['api_key', 'apiKey', 'password', 'secret', 'token']);
const MODEL_CREDENTIAL_WORKERS = new Set(['asr', 'tts', 'ocr']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateWorkerName(name: unknown): asserts name is string {
  if (!name || typeof name !== 'string') {
    throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'Worker name is required');
  }

  if (!WORKER_NAME_RE.test(name)) {
    throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'Worker name must be 1-64 chars of [a-zA-Z0-9_-]');
  }
}

function ensureKnownWorker(name: string): void {
  const manager = WorkerManager.getInstance();
  if (!manager.getWorkerInfo(name)) {
    throw new GatewayMethodError(GatewayErrorCode.NOT_FOUND, `Worker "${name}" not found`);
  }
}

function resolveUnder(baseDir: string, targetPath: string): string {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(targetPath);

  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'Invalid worker path');
  }

  return resolved;
}

function getWorkerScriptDir(name: string): string {
  return resolveUnder(BusinessPaths.workers.scripts, BusinessPaths.workers.getScriptDir(name));
}

function getWorkerManifestPath(name: string): string {
  return resolveUnder(BusinessPaths.workers.scripts, path.join(getWorkerScriptDir(name), 'worker.json'));
}

function getWorkerConfigPath(name: string): string {
  return resolveUnder(BusinessPaths.workers.runtimeWorkers, BusinessPaths.workers.getConfigPath(name));
}

function readWorkerManifest(name: string): WorkerConfig {
  const manifestPath = getWorkerManifestPath(name);

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('worker.json must be an object');
    }
    return parsed as WorkerConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, `Failed to read worker.json: ${message}`);
  }
}

function writeWorkerManifest(name: string, manifest: WorkerConfig): void {
  const manifestPath = getWorkerManifestPath(name);
  const content = JSON.stringify(manifest, null, 2) + '\n';
  const tmpPath = `${manifestPath}.tmp.${process.pid}`;

  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, manifestPath);
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup error
    }
    throw error;
  }
}

function readWorkerConfig(name: string): Record<string, unknown> {
  const configPath = getWorkerConfigPath(name);
  if (!fs.existsSync(configPath)) return {};

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch (error) {
    log.warn(`[worker.configGet] Failed to read config for ${name}:`, error);
    return {};
  }
}

function writeWorkerConfig(name: string, config: Record<string, unknown>): void {
  const configPath = getWorkerConfigPath(name);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  const content = JSON.stringify(config, null, 2) + '\n';
  const tmpPath = `${configPath}.tmp.${process.pid}`;

  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, configPath);
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup error
    }
    throw error;
  }
}

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.has(key) && typeof value === 'string' && value.length > 4) {
    return `${value.slice(0, 4)}****`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue('', item));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = redactValue(childKey, childValue);
    }
    return result;
  }

  return value;
}

function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  return redactValue('', config) as Record<string, unknown>;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

function deepMergeConfig(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const [key, value] of Object.entries(source)) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMergeConfig(current, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function normalizeWorkerRuntimeConfig(name: string, config: Record<string, unknown>): Record<string, unknown> {
  if (!MODEL_CREDENTIAL_WORKERS.has(name)) {
    return structuredClone(config);
  }

  const normalized = structuredClone(config);
  const modelName = typeof normalized.model_name === 'string' ? normalized.model_name.trim() : '';
  const legacyApiKey = typeof normalized.api_key === 'string' ? normalized.api_key.trim() : '';
  const rawCredentials = normalized.model_credentials;
  const modelCredentials = isPlainObject(rawCredentials) ? structuredClone(rawCredentials) : {};

  if (modelName && legacyApiKey) {
    const existingEntry = modelCredentials[modelName];
    const nextEntry = isPlainObject(existingEntry) ? { ...existingEntry } : {};
    if (typeof nextEntry.api_key !== 'string' || !nextEntry.api_key.trim()) {
      nextEntry.api_key = legacyApiKey;
    }
    modelCredentials[modelName] = nextEntry;
  }

  normalized.model_credentials = modelCredentials;
  delete normalized.api_key;
  delete normalized.apiKey;
  delete normalized.api_url;
  delete normalized.apiUrl;

  return normalized;
}

function hasMeaningfulConfigChange(existing: Record<string, unknown>, updates: Record<string, unknown>): boolean {
  return !deepEqual(existing, updates);
}

function isWorkerRunning(info: WorkerInfo | undefined): boolean {
  return !!info && ['initializing', 'starting', 'ready'].includes(info.status);
}

function getWorkerConnectHost(): string {
  const host = Env.main.workerHost || '127.0.0.1';
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
}

async function readWorkerResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

function getWorkerResponseError(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const payload = body as { error?: unknown; message?: unknown };
    if (typeof payload.error === 'string') return payload.error;
    if (typeof payload.message === 'string') return payload.message;
  }
  if (typeof body === 'string' && body.trim()) return body.trim();
  return fallback;
}

export const workerMethods: MethodGroup = {
  namespace: 'worker',

  methods: {
    /**
     * 获取所有已注册 Worker 的运行状态。
     */
    list: async () => {
      const workers = WorkerManager.getInstance().getAllWorkerInfo();
      return { workers };
    },

    /**
     * 后台启动 Worker。
     *
     * 启动过程可能包含 venv 初始化和模型加载，因此这里不阻塞等待完成；
     * 前端通过 worker:status 推送或 worker.list 轮询获取进度。
     */
    start: async (params) => {
      const { name } = params;
      validateWorkerName(name);
      ensureKnownWorker(name);

      log.info(`[worker.start] Starting worker: ${name}`);
      const manager = WorkerManager.getInstance();

      manager.start(name).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`[worker.start] Failed: ${name}`, message);
      });

      return { ok: true, name };
    },

    /**
     * 停止 Worker。
     */
    stop: async (params) => {
      const { name } = params;
      validateWorkerName(name);
      ensureKnownWorker(name);

      try {
        await WorkerManager.getInstance().stop(name);
        return { ok: true, name };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`[worker.stop] Failed: ${name}`, error);
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, message);
      }
    },

    /**
     * 更新 worker.json 中的 autoStart。
     */
    autoStartUpdate: async (params) => {
      const { name, autoStart } = params as { name?: unknown; autoStart?: unknown };
      validateWorkerName(name);
      ensureKnownWorker(name);

      if (typeof autoStart !== 'boolean') {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'autoStart must be a boolean');
      }

      try {
        const manifest = readWorkerManifest(name);
        const nextManifest: WorkerConfig = {
          ...manifest,
          name: manifest.name || name,
          autoStart
        };

        writeWorkerManifest(name, nextManifest);
        await WorkerManager.getInstance().reloadWorkerConfig(name);

        log.info(`[worker.autoStartUpdate] ${name}: autoStart=${autoStart}`);
        return { name, autoStart };
      } catch (error) {
        if (error instanceof GatewayMethodError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        log.error(`[worker.autoStartUpdate] Failed: ${name}`, error);
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, `Failed to update worker.json: ${message}`);
      }
    },

    /**
     * 获取 Worker 的可选模型定义。
     */
    modelsGet: async (params) => {
      const { name } = params;
      validateWorkerName(name);
      ensureKnownWorker(name);

      const modelsFile = path.join(getWorkerScriptDir(name), 'models.json');
      if (!fs.existsSync(modelsFile)) {
        return { name, models: null };
      }

      try {
        const raw = fs.readFileSync(modelsFile, 'utf-8');
        const models = JSON.parse(raw);
        return { name, models };
      } catch (error) {
        log.warn(`[worker.modelsGet] Failed to read models.json for ${name}:`, error);
        return { name, models: null };
      }
    },

    /**
     * 获取 Worker 运行时配置。
     */
    configGet: async (params) => {
      const { name } = params;
      validateWorkerName(name);
      ensureKnownWorker(name);

      const config = normalizeWorkerRuntimeConfig(name, readWorkerConfig(name));
      log.info(`[worker.configGet] ${name}: ${JSON.stringify(redactConfig(config))}`);
      return { name, config };
    },

    /**
     * 合并更新 Worker 运行时配置。
     *
     * 配置写入可写运行目录，Worker 启动时通过 WORKER_CONFIG_PATH 读取。
     */
    configUpdate: async (params) => {
      const { name, config: updates } = params as {
        name?: unknown;
        config?: unknown;
      };

      validateWorkerName(name);
      ensureKnownWorker(name);

      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'config must be a plain object');
      }

      try {
        const existing = normalizeWorkerRuntimeConfig(name, readWorkerConfig(name));
        const normalizedUpdates = updates as Record<string, unknown>;
        const merged = normalizeWorkerRuntimeConfig(name, deepMergeConfig(existing, normalizedUpdates));
        const changed = hasMeaningfulConfigChange(existing, merged);

        writeWorkerConfig(name, merged);
        log.info(`[worker.configUpdate] ${name}: updated ${JSON.stringify(redactConfig(merged))}`);

        let restarted = false;
        const manager = WorkerManager.getInstance();
        const info = manager.getWorkerInfo(name);

        if (changed && isWorkerRunning(info)) {
          log.info(`[worker.configUpdate] ${name}: config changed, restarting worker...`);
          await manager.stop(name);
          manager.start(name).catch((error) => {
            log.warn(`[worker.configUpdate] ${name}: auto-restart failed:`, error);
          });
          restarted = true;
        }

        return { name, config: merged, restarted };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`[worker.configUpdate] Failed to write config for ${name}:`, error);
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, `Failed to save config: ${message}`);
      }
    },

    /**
     * 实际测试 Worker。
     *
     * 若 Worker 未启动，则先启动并等待健康检查通过；
     * 随后调用 Worker 自己的 /api/test，让具体 Worker 执行真实 provider 测试。
     */
    test: async (params) => {
      const { name } = params;
      validateWorkerName(name);
      ensureKnownWorker(name);

      const manager = WorkerManager.getInstance();
      let info = manager.getWorkerInfo(name);
      let started = false;

      try {
        if (!info || info.status !== 'ready') {
          log.info(`[worker.test] Worker ${name} is not ready, starting before test...`);
          await manager.start(name);
          started = true;
          info = manager.getWorkerInfo(name);
        }

        if (!info || info.status !== 'ready' || !info.port) {
          throw new Error(info?.error || `Worker "${name}" is not ready`);
        }

        const url = `http://${getWorkerConnectHost()}:${info.port}/api/test`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(120000)
        });
        const body = await readWorkerResponse(response);

        if (!response.ok) {
          throw new Error(getWorkerResponseError(body, `Worker test failed: HTTP ${response.status}`));
        }

        log.info(`[worker.test] ${name}: ${JSON.stringify(redactConfig(body as Record<string, unknown>))}`);
        return { name, started, result: body };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`[worker.test] Failed: ${name}`, message);
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, message);
      }
    }
  }
};
