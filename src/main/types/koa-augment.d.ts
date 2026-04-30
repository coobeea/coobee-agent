/**
 * Koa Request 类型增强
 *
 * `@koa/multer` 的 d.ts 会把 koa 的 Request 类型替换为不带 `body` 的新类型，
 * 导致本项目里所有依赖 `koa-bodyparser` 注入 `ctx.request.body` 的代码失去类型。
 *
 * 这里通过 declare module 'koa' 的接口合并，把 `body` 和 `files` 字段显式加回。
 */

import type { File as MulterFile } from '@koa/multer';

declare module 'koa' {
  interface Request {
    /** koa-bodyparser 解析后的请求体 */
    body?: unknown;
    /** @koa/multer 多文件上传时注入的文件列表 */
    files?: MulterFile[] | Record<string, MulterFile[]>;
    /** @koa/multer 单文件上传时注入的文件对象 */
    file?: MulterFile;
  }
}

export {};
