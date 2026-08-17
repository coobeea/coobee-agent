/**
 * 进程级内核日志契约（printf 风格可变参数）。
 * 实现由调用方注入；harness 内部只依赖本接口。
 */
export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

class NopLogger implements Logger {
  info(_msg: string, ..._args: unknown[]): void {
    /* noop */
  }
  warn(_msg: string, ..._args: unknown[]): void {
    /* noop */
  }
  error(_msg: string, ..._args: unknown[]): void {
    /* noop */
  }
  debug(_msg: string, ..._args: unknown[]): void {
    /* noop */
  }
}

const NOP = new NopLogger();

/** 丢弃全部输出的 Logger。 */
export function nopLogger(): Logger {
  return NOP;
}

/** 非空返回原 Logger，否则返回 Nop。 */
export function orNop(logger: Logger | null | undefined): Logger {
  return logger ?? NOP;
}
