/**
 * Stream 事件推送配置
 *
 * 声明需要推送到 WebSocket 的 Stream 相关事件
 */

import { GatewayEventTypes } from '@shared/events/gateway';

export default [GatewayEventTypes.STREAM_MESSAGE, 'stream:start', 'stream:end', 'stream:error'];
