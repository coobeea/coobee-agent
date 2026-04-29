/**
 * Thread API Types
 */

import type { ApiResponse } from '@shared/api';
import type { ThreadEntry, ThreadRuntimeType, ThreadStatus } from '@shared/events/thread';

export type { ApiResponse };

export interface UpdateThreadReqVO {
  title?: string;
  status?: ThreadStatus;
  overrideModel?: string | null;
  runtimeType?: ThreadRuntimeType;
  enableThinking?: boolean;
  asrEnabled?: boolean;
  ttsEnabled?: boolean;
}

export interface UpdateThreadRespVO {
  thread: ThreadEntry;
}

export interface DeleteThreadRespVO {
  threadId: string;
  deleted: boolean;
}
