/**
 * 测试用 WebSocket 客户端封装
 *
 * 简化版的 GatewayClient，专门用于 E2E 测试
 */

import WebSocket from 'ws';
import type {
  GatewayRequest,
  GatewayResponse,
  GatewayEvent,
  GatewayOutMessage
} from '../../src/shared/gateway-protocol';

export interface TestWsClientOptions {
  url: string;
  timeout?: number;
  debug?: boolean;
}

export class TestWsClient {
  private ws: WebSocket | null = null;
  private url: string;
  private timeout: number;
  private debug: boolean;
  private requestIdCounter = 0;
  private pendingRequests = new Map<
    string,
    {
      resolve: (data: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private eventListeners = new Map<string, ((payload: unknown) => void)[]>();

  constructor(options: TestWsClientOptions) {
    this.url = options.url;
    this.timeout = options.timeout ?? 30000;
    this.debug = options.debug ?? false;
  }

  /**
   * 连接 WebSocket
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.debug) console.log(`[TestWsClient] Connecting to ${this.url}`);

      this.ws = new WebSocket(this.url);

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        if (this.debug) console.log('[TestWsClient] Connected');
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as GatewayOutMessage;
          this.handleMessage(msg);
        } catch (err) {
          console.error('[TestWsClient] Failed to parse message:', err);
        }
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        if (this.debug) console.error('[TestWsClient] Error:', error);
        reject(error);
      });

      this.ws.on('close', () => {
        if (this.debug) console.log('[TestWsClient] Disconnected');
        this.rejectAllPending();
      });
    });
  }

  /**
   * 关闭连接
   */
  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.rejectAllPending();
  }

  /**
   * 发送 RPC 请求
   */
  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const id = this.generateRequestId();
    const request: GatewayRequest = {
      type: 'req',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.timeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      if (this.debug) {
        console.log(`[TestWsClient] >>> Request:`, { method, params });
      }

      this.ws!.send(JSON.stringify(request));
    });
  }

  /**
   * 监听事件
   */
  on(event: string, listener: (payload: unknown) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  /**
   * 移除事件监听
   */
  off(event: string, listener: (payload: unknown) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * 等待特定事件（Promise 风格）
   */
  waitForEvent(event: string, timeout = 30000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(event, handler);
        reject(new Error(`Event timeout: ${event}`));
      }, timeout);

      const handler = (payload: unknown) => {
        clearTimeout(timer);
        this.off(event, handler);
        resolve(payload);
      };

      this.on(event, handler);
    });
  }

  /**
   * 获取连接状态
   */
  get readyState(): number | undefined {
    return this.ws?.readyState;
  }

  /**
   * 是否已连接
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ==================== 私有方法 ====================

  private handleMessage(msg: GatewayOutMessage): void {
    if (msg.type === 'res') {
      this.handleResponse(msg as GatewayResponse);
    } else if (msg.type === 'event') {
      this.handleEvent(msg as GatewayEvent);
    }
  }

  private handleResponse(response: GatewayResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      if (this.debug) {
        console.warn(`[TestWsClient] No pending request for id: ${response.id}`);
      }
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);

    if (this.debug) {
      console.log(`[TestWsClient] <<< Response:`, response);
    }

    if (response.ok) {
      pending.resolve(response.payload);
    } else {
      pending.reject(
        new Error(`RPC Error [${response.error?.code}]: ${response.error?.message}`)
      );
    }
  }

  private handleEvent(event: GatewayEvent): void {
    if (this.debug) {
      console.log(`[TestWsClient] <<< Event: ${event.event}`, event.payload);
    }

    const listeners = this.eventListeners.get(event.event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event.payload);
        } catch (err) {
          console.error(`[TestWsClient] Event listener error:`, err);
        }
      }
    }
  }

  private generateRequestId(): string {
    this.requestIdCounter++;
    return `test-${Date.now()}-${this.requestIdCounter}`;
  }

  private rejectAllPending(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }
}
