/**
 * 贯穿本轮执行线的取消信号（对齐 AbortSignal）。
 * 不承载 SessionID 等身份字段（那些在 RunnerConfig）。
 */
export class Signal {
  constructor(readonly abortSignal: AbortSignal) {}

  static from(abortSignal: AbortSignal): Signal {
    return new Signal(abortSignal);
  }

  static none(): Signal {
    return new Signal(new AbortController().signal);
  }

  get aborted(): boolean {
    return this.abortSignal.aborted;
  }

  get reason(): unknown {
    return this.abortSignal.reason;
  }

  throwIfAborted(): void {
    if (this.abortSignal.aborted) {
      const reason = this.abortSignal.reason;
      if (reason instanceof Error) {
        throw reason;
      }
      throw new Error(typeof reason === 'string' ? reason : 'aborted');
    }
  }
}

export const ErrSignalNil = new Error('types: signal abortSignal is required');
