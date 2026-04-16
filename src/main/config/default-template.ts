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
  // 在 Vite 打包后，__dirname 指向 out/main，而文件被复制到了 out/main/config
  const templatePath = path.join(__dirname, 'config', 'default-config.json5');

  // 兼容开发环境或未打包的场景
  if (fs.existsSync(templatePath)) {
    return fs.readFileSync(templatePath, 'utf-8');
  }
  return fs.readFileSync(path.join(__dirname, 'default-config.json5'), 'utf-8');
}

/**
 * 生成默认 Providers 配置内容（providers.json5）
 *
 * @returns JSON5 格式的 Providers 配置字符串
 */
export function generateDefaultProviders(): string {
  const templatePath = path.join(__dirname, 'config', 'default-providers.json5');

  if (fs.existsSync(templatePath)) {
    return fs.readFileSync(templatePath, 'utf-8');
  }
  return fs.readFileSync(path.join(__dirname, 'default-providers.json5'), 'utf-8');
}

/**
 * 生成默认 Secrets 配置内容（secrets.json5）
 *
 * @returns JSON5 格式的 Secrets 配置字符串
 */
export function generateDefaultSecrets(): string {
  const templatePath = path.join(__dirname, 'config', 'default-secrets.json5');

  if (fs.existsSync(templatePath)) {
    return fs.readFileSync(templatePath, 'utf-8');
  }
  return fs.readFileSync(path.join(__dirname, 'default-secrets.json5'), 'utf-8');
}
