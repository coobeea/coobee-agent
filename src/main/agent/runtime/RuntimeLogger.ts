/**
 * Runtime Logger — 零依赖日志工具
 *
 * 优先使用项目 createLogger（electron 环境），
 * fallback 到 console（独立测试环境）。
 *
 * 这样任何文件都能安全引用，不会因为缺少 electron
 * 而导致整个模块加载失败。
 */

/** Runtime 内部日志接口 */
export interface RuntimeLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

/**
 * 创建 Runtime 日志实例
 *
 * 优先使用项目 createLogger，fallback 到 console（测试环境）。
 */
export function createRuntimeLogger(moduleName: string): RuntimeLogger {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createLogger } = require('@main/common/logger');
    return createLogger(moduleName) as RuntimeLogger;
  } catch {
    const prefix = `[${moduleName}]`;
    return {
      info: (msg: string, ...args: unknown[]) => console.log(`${prefix} ${msg}`, ...args),
      warn: (msg: string, ...args: unknown[]) => console.warn(`${prefix} ${msg}`, ...args),
      error: (msg: string, ...args: unknown[]) => console.error(`${prefix} ${msg}`, ...args),
      debug: (msg: string, ...args: unknown[]) => console.debug(`${prefix} ${msg}`, ...args)
    };
  }
}
