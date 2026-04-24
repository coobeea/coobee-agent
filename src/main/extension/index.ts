/**
 * Extension 系统统一导出
 */

export { ExtensionRegistry } from './ExtensionRegistry';
export { ExtensionHookRunner } from './ExtensionHookRunner';
export { ExtensionManager } from './ExtensionManager';
export { ExtensionLoader } from './ExtensionLoader';
export { createExtensionApi } from './ExtensionApi';

// 类型
export type {
  ExtensionManifest,
  ExtensionOrigin,
  ExtensionModule,
  ExtensionLogger,
  ExtensionApi,
  ExtensionEventBus,
  ExtensionHookCategory,
  AgentEventName,
  AgentInterceptorName,
  ExtensionHookName,
  ExtensionHookDefinition,
  ExtensionHookMode,
  ExtensionHookHandler,
  ExtensionHookEventMap,
  ExtensionHookResultMap,
  RegisteredExtensionHook,
  RegisteredExtensionTool,
  RegisteredExtensionMethod,
  RegisteredExtensionSkillDir,
  PrepareRunInputEvent,
  PrepareRunInputResult,
  PrepareToolCallEvent,
  PrepareToolCallResult,
  TransformToolResultEvent,
  TransformToolResultResult,
  RunStartedEvent,
  RunCompletedEvent,
  ToolCallCompletedEvent,
  MessageReceivedEvent,
  TurnStartedEvent,
  TurnCompletedEvent,
  CompactionStartedEvent,
  CompactionCompletedEvent
} from './types';

export { EXTENSION_HOOK_DEFINITIONS, EXTENSION_HOOK_MODE } from './types';
