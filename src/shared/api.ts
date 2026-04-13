/**
 * API Request/Response Types
 */

/**
 * 请求控制选项
 */
export interface RequestOptions {
  timeout?: number;
  method?: 'get' | 'post';
  useQs?: boolean;
}

/**
 * 统一请求包装对象（前后端共享）
 */
export interface UnifiedRequest {
  args: unknown[];
  options?: RequestOptions;
  requestId: string;
  timestamp: number;
  token?: string;
}

/**
 * 标准 API 响应格式
 * 
 * 前后端统一的响应格式，用于所有 HTTP REST API 和 RPC 调用
 * 
 * @template T 响应数据类型
 * 
 * @example
 * // 成功响应
 * const response: ApiResponse<UserVO> = {
 *   success: true,
 *   data: { id: '1', name: '张三' }
 * };
 * 
 * // 错误响应
 * const response: ApiResponse = {
 *   success: false,
 *   error: '用户不存在'
 * };
 */
export interface ApiResponse<T = unknown> {
  /** 请求是否成功 */
  success: boolean;
  /** 成功时的返回数据 */
  data?: T;
  /** 失败时的错误信息 */
  error?: string;
  /** 附加消息（可选） */
  message?: string;
  /** 错误码（可选） */
  code?: string;
  /** 时间戳（可选） */
  timestamp?: number;
}

/**
 * @deprecated 使用 ApiResponse<T> 替代
 * 为了向后兼容保留的别名
 */
export type Result<T = unknown> = ApiResponse<T>;

/**
 * Stream 数据流结果类型
 */
export interface StreamData<T = unknown> {
  chunk: T;
  isLast?: boolean;
  metadata?: {
    contentType?: string;
    filename?: string;
    size?: number;
    progress?: number;
    contentDisposition?: 'inline' | 'attachment';
    cacheControl?: string;
    etag?: string;
    contentRange?: string;
    customHeaders?: Record<string, string>;
    statusCode?: number;
    [key: string]: unknown;
  };
}

/**
 * 错误码类
 */
export class ErrorCode {
  constructor(
    public code: string,
    public message: string,
    public status: number
  ) {}

  static of(code: string, message: string, status: number = 500): ErrorCode {
    return new ErrorCode(code, message, status);
  }
}

/**
 * 错误码对象集合
 */
export const ErrorCodes = {
  SYSTEM_ERROR: ErrorCode.of('100-000-000', '系统内部错误', 200),
  MAINTENANCE_MODE: ErrorCode.of('100-000-001', '系统维护中', 200),
  AUTH_PERMISSION_DENIED: ErrorCode.of('100-001-000', '权限不足', 403)
} as const;

export type ErrorCodeKey = keyof typeof ErrorCodes;

// ==================== SSE 流式类型 ====================

/**
 * SSE 流式数据包装类型
 */
export interface SSEStreamResult<T = unknown> {
  type: 'data' | 'error' | 'end' | 'start' | 'heartbeat';
  data?: T;
  error?: string;
  streamId?: string;
  timestamp: number;
}

// ==================== 设备信息类型 ====================

/**
 * 设备信息
 */
export interface DeviceInfo {
  platform: NodeJS.Platform;
  arch: string;
  cpuModel: string;
  totalMemory: number;
  osVersion: string;
  osVersionMetadata: Array<{ name: string; build: number }>;
}

/**
 * 内存使用信息
 */
export interface MemoryInfo {
  total: number;
  free: number;
  used: number;
}

/**
 * 磁盘空间信息
 */
export interface DiskInfo {
  total: number;
  free: number;
  used: number;
}

// ==================== 快捷键类型 ====================

/**
 * 快捷键配置
 */
export interface Shortcut {
  key: string;
  shortcut: string;
  editable: boolean;
  enabled: boolean;
  global?: boolean;
  registered?: boolean;
}
