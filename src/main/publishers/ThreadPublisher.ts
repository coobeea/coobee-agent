/**
 * Thread 事件推送配置。
 *
 * 后端 ThreadStore 统一发 thread:message，Gateway 原样推送到前端。
 */

import { ThreadEventTypes } from '@shared/events/thread';

export default [ThreadEventTypes.MESSAGE];
