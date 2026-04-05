/**
 * 共享常量定义
 * 在主进程和渲染进程之间共享的常量
 */

export const APP_NAME = 'coobee-agent'
export const APP_VERSION = '1.0.0'

// IPC 通道名称
export const IPC_CHANNELS = {
  PING: 'ping',
  GET_APP_VERSION: 'get-app-version',
  GET_APP_PATH: 'get-app-path'
} as const
