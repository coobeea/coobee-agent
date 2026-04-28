/**
 * 通用事件消息格式。
 *
 * 这里只描述“事件如何被包装成一条消息”，不绑定 IPC、Gateway
 * 或具体业务事件来源。
 */
export interface EventMessage<T extends string = string, P = unknown> {
  /** 事件类型 */
  type: T;
  /** 事件负载 */
  payload: P;
  /** 事件时间戳 */
  timestamp: number;
}
