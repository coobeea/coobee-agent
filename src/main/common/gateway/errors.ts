/**
 * Gateway RPC 错误定义
 */

/**
 * Gateway 标准错误码
 */
export enum GatewayErrorCode {
  // 消息错误 1xxx
  /** 消息解析失败 */
  PARSE_ERROR = 1001,
  /** 无效消息格式 */
  INVALID_MESSAGE = 1002,
  /** 未知消息类型 */
  UNKNOWN_MESSAGE_TYPE = 1003,

  // 方法错误 2xxx
  /** 方法不存在 */
  METHOD_NOT_FOUND = 2001,
  /** 参数错误 */
  INVALID_PARAMS = 2002,

  // 业务错误 3xxx
  /** 会话忙碌 */
  SESSION_BUSY = 3001,
  /** 资源不存在 */
  NOT_FOUND = 3002,
  /** 内部错误 */
  INTERNAL_ERROR = 3003,

  // 权限错误 4xxx
  /** 未授权 */
  UNAUTHORIZED = 4001,

  // 超时错误 5xxx
  /** 请求超时 */
  TIMEOUT = 5001
}

/**
 * Gateway 方法错误
 *
 * 用于方法处理器中抛出结构化错误
 */
export class GatewayMethodError extends Error {
  constructor(
    public code: GatewayErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'GatewayMethodError';
  }
}
