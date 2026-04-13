/**
 * 默认配置模板生成器
 *
 * 首次启动时用于生成 coobee.json5。
 * 从 default-config.json5 读取预置的配置模板。
 */
import fs from 'fs';
import path from 'path';

/**
 * 生成默认配置内容
 *
 * 从同目录下的 default-config.json5 读取模板配置。
 * 模板包含所有预置供应商和模型，API Key 为空、供应商默认禁用。
 *
 * @returns JSON5 格式的配置字符串
 */
export function generateDefaultConfig(): string {
  const templatePath = path.join(__dirname, 'default-config.json5');
  return fs.readFileSync(templatePath, 'utf-8');
}
