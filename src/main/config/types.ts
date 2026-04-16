/**
 * 配置模块类型定义
 */

/**
 * 配置模块生命周期接口
 *
 * 所有需要自动加载的配置模块都应实现此接口
 *
 * 使用示例：
 * ```typescript
 * class ProviderConfigLoader implements ConfigModule {
 *   name = 'providers';
 *   enabled = true;
 *
 *   async init(configDir: string, secretsDir: string): Promise<void> {
 *     // 加载 providers.json5
 *   }
 *
 *   async reload(configDir: string, secretsDir: string): Promise<void> {
 *     // 重载配置
 *   }
 * }
 *
 * export const ProvidersModule: ConfigModule = new ProviderConfigLoader();
 * ```
 */
export interface ConfigModule {
  /** 模块名称（用于日志和标识） */
  name: string;

  /** 是否启用（默认 true，设为 false 可禁用模块） */
  enabled?: boolean;

  /**
   * 初始化方法（应用启动时调用一次）
   *
   * @param configDir 配置目录路径 (.home/config/)
   * @param secretsDir 敏感信息目录路径 (.home/config/)
   */
  init?(configDir: string, secretsDir: string): Promise<void> | void;

  /**
   * 热重载方法（配置文件变更时调用）
   *
   * @param configDir 配置目录路径
   * @param secretsDir 敏感信息目录路径
   */
  reload?(configDir: string, secretsDir: string): Promise<void> | void;

  /**
   * 清理方法（应用退出时调用，可选）
   */
  cleanup?(): Promise<void> | void;
}
