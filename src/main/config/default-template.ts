/**
 * 默认配置模板生成器
 *
 * 首次启动时用于生成配置文件。
 * 所有模板都从 default-*.json5 文件读取，统一管理。
 */
import fs from 'fs';
import path from 'path';

/**
 * 生成默认主配置内容（coobee.json5）
 *
 * @returns JSON5 格式的配置字符串
 */
export function generateDefaultConfig(): string {
  const templatePath = path.join(__dirname, 'default-config.json5');
  return fs.readFileSync(templatePath, 'utf-8');
}

/**
 * 生成默认 Providers 配置内容（providers.json5）
 *
 * @returns JSON5 格式的 Providers 配置字符串
 */
export function generateDefaultProviders(): string {
  const templatePath = path.join(__dirname, 'default-providers.json5');
  return fs.readFileSync(templatePath, 'utf-8');
}

/**
 * 生成默认 Secrets 配置内容（secrets.json5）
 *
 * @returns JSON5 格式的 Secrets 配置字符串
 */
export function generateDefaultSecrets(): string {
  const templatePath = path.join(__dirname, 'default-secrets.json5');
  return fs.readFileSync(templatePath, 'utf-8');
}
