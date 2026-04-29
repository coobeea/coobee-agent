/**
 * Worker Gateway 事件类型。
 */

export const WorkerEventTypes = {
  STATUS: 'worker:status',
  PROGRESS: 'worker:progress',
  ERROR: 'worker:error'
} as const;

export type WorkerEventType = (typeof WorkerEventTypes)[keyof typeof WorkerEventTypes];

export type WorkerStatus = 'stopped' | 'initializing' | 'starting' | 'ready' | 'error' | 'stopping';

export interface WorkerMetrics {
  cpuPercent: number;
  memoryBytes: number;
  memoryPercent: number;
  healthCheckLatency: number;
  uptimeSeconds: number;
  lastHealthCheck: {
    success: boolean;
    timestamp: number;
    latency: number;
  };
}

export interface WorkerInfo {
  name: string;
  label: string;
  /** 是否随应用启动自动拉起，对应 worker.json 中的 autoStart */
  autoStart: boolean;
  status: WorkerStatus;
  port?: number;
  error?: string;
  pid?: number;
  restartCount: number;
  updatedAt: number;
  metrics?: WorkerMetrics;
}

export interface WorkerStatusEventPayload {
  type: typeof WorkerEventTypes.STATUS;
  worker: WorkerInfo;
}

export interface WorkerProgressEventPayload {
  type?: typeof WorkerEventTypes.PROGRESS;
  name?: string;
  message?: string;
  progress?: number;
  [key: string]: unknown;
}

export interface WorkerErrorEventPayload {
  type?: typeof WorkerEventTypes.ERROR;
  name?: string;
  error?: string;
  message?: string;
  [key: string]: unknown;
}
