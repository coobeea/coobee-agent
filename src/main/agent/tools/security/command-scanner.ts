/**
 * 命令扫描模块
 *
 * 检测 exec 工具执行的命令是否尝试访问敏感路径或执行危险操作
 */

import { Env } from '@main/common/env';
import { checkSensitivePath } from './sensitive-paths';

/**
 * 危险命令模式（正则表达式）
 */
const DANGEROUS_PATTERNS = [
  // 访问敏感文件
  { pattern: /secrets\.json5/, label: 'secrets.json5' },
  { pattern: /skills\.json5/, label: 'skills.json5' },
  { pattern: /\.env(\s|$)/, label: '.env' },

  // 访问敏感目录
  { pattern: /[/\\]secrets[/\\]/, label: 'secrets' },
  { pattern: /\.coobee-ai[/\\]secrets/, label: 'secrets' },
  { pattern: /\.home[/\\]secrets/, label: 'secrets' },

  // 危险的系统操作
  { pattern: /rm\s+-rf\s+\//, label: 'rm -rf' }, // 删除根目录
  { pattern: /chmod\s+777/, label: 'chmod 777' }, // 过度开放权限
  { pattern: /sudo\s+/, label: 'sudo' }, // 提权操作
  { pattern: /su\s+/, label: 'su' }, // 切换用户

  // 网络渗透工具
  { pattern: /\b(nmap|metasploit|sqlmap|hydra|john)\b/, label: 'network attack tool' },

  // 恶意文件操作
  { pattern: />\s*\/dev\/sda/, label: '/dev/sda' }, // 直接写入磁盘
  { pattern: /dd\s+if=.*of=\/dev/, label: 'dd to /dev' } // 危险的 dd 操作
];

/**
 * 白名单命令前缀（即使包含敏感关键词也允许执行）
 */
const SAFE_COMMAND_PREFIXES = [
  'echo',
  'cat',
  'ls',
  'pwd',
  'cd',
  'mkdir',
  'touch',
  'node',
  'npm',
  'pnpm',
  'yarn',
  'git',
  'python',
  'python3',
  'tsx',
  'tsc'
];

/**
 * 检查命令是否安全
 *
 * @param command 要检查的命令字符串
 * @param workingDir 命令的工作目录
 * @returns 如果安全返回 null，否则返回错误消息
 */
export function scanCommand(command: string, workingDir?: string): string | null {
  // 即使命令本身在白名单里，也不允许在敏感目录中执行。
  if (workingDir) {
    const check = checkSensitivePath(workingDir);
    const secretsDir = Env.paths.secretsDir;

    if (check.sensitive || (secretsDir && workingDir.startsWith(secretsDir))) {
      return `Cannot execute commands in sensitive directory: ${workingDir}/. Operation blocked.`;
    }
  }

  // 检查是否为白名单命令（宽松检查，允许参数）
  const firstToken = command.trim().split(/\s+/)[0];
  const isWhitelisted = SAFE_COMMAND_PREFIXES.some((prefix) => {
    return firstToken === prefix || firstToken.endsWith(`/${prefix}`) || firstToken.endsWith(`\\${prefix}`);
  });

  // 白名单命令跳过危险模式检查（它们可能需要读取敏感文件名，但不会修改）
  if (isWhitelisted) {
    return null;
  }

  // 检查危险模式
  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return `Dangerous command pattern detected: ${label}. Operation blocked for security.`;
    }
  }

  return null;
}

/**
 * 扫描 Python/Node.js 脚本内容中的敏感操作
 *
 * @param scriptContent 脚本内容
 * @returns 如果安全返回 null，否则返回错误消息
 */
export function scanScriptContent(scriptContent: string): string | null {
  // 检查是否尝试读取敏感文件
  const sensitiveFilePatterns = [
    /open\s*\(\s*['"`].*secrets\.json5['"`]/,
    /open\s*\(\s*['"`].*skills\.json5['"`]/,
    /readFileSync\s*\(\s*['"`].*secrets\.json5['"`]/,
    /readFileSync\s*\(\s*['"`].*skills\.json5['"`]/,
    /\.read\s*\(\s*['"`].*secrets\.json5['"`]/,
    /\.read\s*\(\s*['"`].*skills\.json5['"`]/
  ];

  for (const pattern of sensitiveFilePatterns) {
    if (pattern.test(scriptContent)) {
      return `Script attempts to access sensitive files. Use official config APIs instead.`;
    }
  }

  // 检查是否尝试访问 secrets 目录
  if (/[/\\]secrets[/\\]/.test(scriptContent)) {
    return `Script attempts to access sensitive directory: /secrets/. Operation blocked.`;
  }

  return null;
}
