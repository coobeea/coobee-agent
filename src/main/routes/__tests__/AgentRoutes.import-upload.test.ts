import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { createImportUploadErrorResponse, registerAgentRoutes } from '../AgentRoutes';

async function startTestServer(): Promise<{ server: http.Server; port: number }> {
  const app = new Koa();
  app.use(bodyParser());

  const router = new Router({ prefix: '/gateway' });
  registerAgentRoutes(router);
  app.use(router.routes());
  app.use(router.allowedMethods());

  const server = http.createServer(app.callback());
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  return {
    server,
    port: (server.address() as AddressInfo).port
  };
}

describe('AgentRoutes import upload errors', () => {
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    const started = await startTestServer();
    server = started.server;
    port = started.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns ApiResponse JSON when multipart uses the wrong file field', async () => {
    const form = new FormData();
    form.append('wrong', new Blob(['zip-content']), 'agent.zip');

    const res = await fetch(`http://127.0.0.1:${port}/gateway/agents/import`, {
      method: 'POST',
      body: form
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      code: 'LIMIT_UNEXPECTED_FILE'
    });
    expect(body.error).toContain('file');
  });

  it('maps oversized uploads to a standard 413 ApiResponse', () => {
    const err = Object.assign(new Error('File too large'), {
      name: 'MulterError',
      code: 'LIMIT_FILE_SIZE'
    });

    const { status, response } = createImportUploadErrorResponse(err);

    expect(status).toBe(413);
    expect(response).toMatchObject({
      success: false,
      code: 'LIMIT_FILE_SIZE'
    });
    expect(response.error).toContain('200MB');
  });
});
