/**
 * Worker 透明代理路由
 *
 * 前端只访问 Gateway，Gateway 再转发到本机 Worker 服务。
 */

import http from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { Duplex } from 'node:stream';
import type Router from '@koa/router';
import type Koa from 'koa';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

import { WorkerManager } from '@main/common/worker';
import { Env } from '@main/common/env';
import { createLogger } from '@main/common/logger';
import type { GatewayRouteHost } from '@main/common/gateway/types';
import type { WorkerInfo } from '@main/common/worker/types';

const log = createLogger('worker-proxy-routes');

const WORKER_PROXY_PREFIX = '/gateway/workers/';
const WORKER_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

interface WorkerProxyPath {
  name: string;
  targetPath: string;
}

interface WorkerTarget {
  host: string;
  port: number;
  info: WorkerInfo;
}

interface PendingWsMessage {
  data: RawData;
  isBinary: boolean;
}

function parseWorkerProxyPath(pathname: string): WorkerProxyPath | null {
  if (!pathname.startsWith(WORKER_PROXY_PREFIX)) return null;

  const rest = pathname.slice(WORKER_PROXY_PREFIX.length);
  const slashIndex = rest.indexOf('/');
  if (slashIndex <= 0) return null;

  const rawName = rest.slice(0, slashIndex);
  let name: string;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    return null;
  }
  if (!WORKER_NAME_RE.test(name)) return null;

  const targetPath = `/${rest.slice(slashIndex + 1)}`;
  if (targetPath === '/') return null;

  return { name, targetPath };
}

function getLocalWorkerHost(): string {
  const host = Env.main.workerHost || '127.0.0.1';
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
}

function getReadyWorkerTarget(name: string): WorkerTarget | null {
  const info = WorkerManager.getInstance().getWorkerInfo(name);
  if (!info || info.status !== 'ready' || !info.port) return null;

  return {
    host: getLocalWorkerHost(),
    port: info.port,
    info
  };
}

function isAllowedHttpTarget(targetPath: string): boolean {
  return targetPath === '/health' || targetPath.startsWith('/api/');
}

function isAllowedWsTarget(targetPath: string): boolean {
  return targetPath.startsWith('/ws/');
}

function filterHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (value == null || HOP_BY_HOP_HEADERS.has(lower) || lower === 'host' || lower === 'content-length') {
      continue;
    }

    result[key] = value;
  }

  return result;
}

function applyProxyResponseHeaders(ctx: Koa.Context, headers: IncomingHttpHeaders): void {
  for (const [key, value] of Object.entries(headers)) {
    if (value == null || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    ctx.set(key, value as string | string[]);
  }
}

async function readRawBody(ctx: Koa.Context): Promise<Buffer | undefined> {
  if (ctx.method === 'GET' || ctx.method === 'HEAD') return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of ctx.req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function getProxyBody(ctx: Koa.Context): Promise<Buffer | string | undefined> {
  if (ctx.method === 'GET' || ctx.method === 'HEAD') return undefined;

  const parsedBody = (ctx.request as { body?: unknown }).body;
  if (parsedBody != null) {
    if (Buffer.isBuffer(parsedBody) || typeof parsedBody === 'string') return parsedBody;
    return JSON.stringify(parsedBody);
  }

  return readRawBody(ctx);
}

async function proxyHttpRequest(ctx: Koa.Context, parsed: WorkerProxyPath, target: WorkerTarget): Promise<void> {
  if (!isAllowedHttpTarget(parsed.targetPath)) {
    ctx.status = 404;
    ctx.body = { error: 'Worker HTTP path not allowed' };
    return;
  }

  const body = await getProxyBody(ctx);
  const headers = filterHeaders(ctx.headers);
  if (body != null) {
    headers['content-length'] = Buffer.byteLength(body).toString();
    if (!headers['content-type']) {
      headers['content-type'] =
        typeof body === 'string' ? 'application/json' : ctx.get('content-type') || 'application/octet-stream';
    }
  }

  await new Promise<void>((resolve) => {
    const proxyReq = http.request(
      {
        hostname: target.host,
        port: target.port,
        path: `${parsed.targetPath}${ctx.search}`,
        method: ctx.method,
        headers: {
          ...headers,
          host: `${target.host}:${target.port}`
        }
      },
      (proxyRes) => {
        ctx.status = proxyRes.statusCode || 502;
        applyProxyResponseHeaders(ctx, proxyRes.headers);
        ctx.body = proxyRes;
        resolve();
      }
    );

    proxyReq.on('error', (error) => {
      log.warn(`[WorkerProxy] HTTP proxy failed: ${parsed.name} ${parsed.targetPath}`, error);
      ctx.status = 502;
      ctx.body = { error: 'Worker proxy failed', message: error.message };
      resolve();
    });

    if (body != null) {
      proxyReq.end(body);
    } else {
      proxyReq.end();
    }
  });
}

function rejectUpgrade(socket: Duplex, statusCode: number, reason: string): void {
  try {
    socket.write(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\n\r\n`);
  } catch {
    // ignore write error
  }
  socket.destroy();
}

function closeWs(ws: WebSocket, code = 1000, reason = 'closed'): void {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    try {
      ws.close(code, reason);
    } catch {
      ws.terminate();
    }
  }
}

function bridgeWorkerWebSocket(
  clientWs: WebSocket,
  parsed: WorkerProxyPath,
  target: WorkerTarget,
  search: string
): void {
  const targetUrl = `ws://${target.host}:${target.port}${parsed.targetPath}${search}`;
  const workerWs = new WebSocket(targetUrl);
  const pending: PendingWsMessage[] = [];
  let workerReady = false;
  let closed = false;

  const closeBoth = (code = 1000, reason = 'closed'): void => {
    if (closed) return;
    closed = true;
    closeWs(clientWs, code, reason);
    closeWs(workerWs, code, reason);
  };

  clientWs.on('message', (data, isBinary) => {
    if (closed) return;

    if (workerReady && workerWs.readyState === WebSocket.OPEN) {
      workerWs.send(data, { binary: isBinary });
      return;
    }

    pending.push({ data, isBinary });
    if (pending.length > 128) {
      closeBoth(1013, 'worker proxy buffer overflow');
    }
  });

  workerWs.on('open', () => {
    workerReady = true;
    while (pending.length > 0 && workerWs.readyState === WebSocket.OPEN) {
      const item = pending.shift()!;
      workerWs.send(item.data, { binary: item.isBinary });
    }
  });

  workerWs.on('message', (data, isBinary) => {
    if (closed || clientWs.readyState !== WebSocket.OPEN) return;
    clientWs.send(data, { binary: isBinary });
  });

  clientWs.on('close', () => closeBoth(1000, 'client closed'));
  workerWs.on('close', () => closeBoth(1000, 'worker closed'));

  clientWs.on('error', (error) => {
    log.warn(`[WorkerProxy] Client WebSocket error: ${parsed.name}`, error);
    closeBoth(1011, 'client error');
  });

  workerWs.on('error', (error) => {
    log.warn(`[WorkerProxy] Worker WebSocket error: ${parsed.name} ${parsed.targetPath}`, error);
    closeBoth(1011, 'worker error');
  });
}

export function registerWorkerProxyRoutes(_router: Router, host?: GatewayRouteHost): void {
  if (!host) {
    log.warn('[WorkerProxy] Gateway route host is unavailable, skip worker proxy registration');
    return;
  }

  const app = host.getApp();
  const proxyWss = new WebSocketServer({ noServer: true });

  app.use(async (ctx, next) => {
    const parsed = parseWorkerProxyPath(ctx.path);
    if (!parsed) {
      await next();
      return;
    }

    const target = getReadyWorkerTarget(parsed.name);
    if (!target) {
      ctx.status = 503;
      ctx.body = { error: 'Worker is not ready', worker: parsed.name };
      return;
    }

    await proxyHttpRequest(ctx, parsed, target);
  });

  host.registerWebSocketUpgrade(WORKER_PROXY_PREFIX, (req, socket, head, pathname) => {
    const parsed = parseWorkerProxyPath(pathname);
    if (!parsed) {
      rejectUpgrade(socket, 404, 'Worker proxy path not found');
      return true;
    }

    if (!isAllowedWsTarget(parsed.targetPath)) {
      rejectUpgrade(socket, 404, 'Worker WebSocket path not allowed');
      return true;
    }

    const target = getReadyWorkerTarget(parsed.name);
    if (!target) {
      rejectUpgrade(socket, 503, 'Worker is not ready');
      return true;
    }

    const search = (() => {
      try {
        return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).search;
      } catch {
        return '';
      }
    })();

    proxyWss.handleUpgrade(req, socket, head, (clientWs) => {
      bridgeWorkerWebSocket(clientWs, parsed, target, search);
    });
    return true;
  });

  log.info('[WorkerProxy] routes registered: /gateway/workers/:name/*');
}
