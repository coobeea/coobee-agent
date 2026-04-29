/**
 * Agent Message 事件推送配置。
 *
 * 后端 Agent 工具统一发 agent:message，Gateway 原样推送到前端。
 */

import { AgentEventTypes } from '@shared/events/agent';

export default [AgentEventTypes.MESSAGE];
