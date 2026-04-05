/**
 * 共享类型定义
 * 在主进程和渲染进程之间共享的类型
 */

export interface AppConfig {
  version: string
  env: 'development' | 'production'
}

export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
