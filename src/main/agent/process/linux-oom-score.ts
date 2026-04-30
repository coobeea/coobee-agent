import fs from 'node:fs';

/**
 * Linux 下由长驻父进程（如 gateway / electron main）fork 的子进程会继承 parent 的
 * `oom_score_adj`。在 cgroup 内存压力下内核倾向于挑 RSS 最大的进程作为 OOM 牺牲者，
 * 结果就是父进程先挂。我们用一个最薄的 /bin/sh 壳把 `oom_score_adj` 抬到 1000，
 * 然后再 `exec` 真正的命令，这样最终进程身份不变，也没有多余的长驻 shell。
 *
 * 可通过设置 `COOBEE_CHILD_OOM_SCORE_ADJ=0 / false / no / off` 关闭。
 */

export const CHILD_OOM_SCORE_ADJ_ENV_KEY = 'COOBEE_CHILD_OOM_SCORE_ADJ';
const OOM_SCORE_WRAP_SHELL = '/bin/sh';
const OOM_SCORE_WRAP_SCRIPT = 'echo 1000 > /proc/self/oom_score_adj 2>/dev/null; exec "$0" "$@"';

// 这些 env 会让 /bin/sh（尤其是以 sh 名义运行的 bash）在 final exec 之前先 source
// 调用方可能控制的启动文件。为了让这一层壳不能被 env 变成代码执行入口，wrap 时统一剥掉。
const SHELL_INIT_ENV_KEYS = ['BASH_ENV', 'ENV', 'CDPATH'] as const;

function isDisabled(value: string | undefined): boolean {
  switch (value?.trim().toLowerCase()) {
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return true;
    default:
      return false;
  }
}

let cachedShellAvailable: boolean | null = null;
function defaultShellAvailable(): boolean {
  if (cachedShellAvailable !== null) {
    return cachedShellAvailable;
  }
  try {
    cachedShellAvailable = fs.statSync(OOM_SCORE_WRAP_SHELL).isFile();
  } catch {
    cachedShellAvailable = false;
  }
  return cachedShellAvailable;
}

export type OomWrapOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  shellAvailable?: () => boolean;
};

export type OomScoreAdjustedSpawn = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv | undefined;
  wrapped: boolean;
};

function shouldWrapChildForOomScore(options: OomWrapOptions | undefined): boolean {
  const platform = options?.platform ?? process.platform;
  if (platform !== 'linux') {
    return false;
  }
  const env = options?.env ?? process.env;
  if (isDisabled(env[CHILD_OOM_SCORE_ADJ_ENV_KEY])) {
    return false;
  }
  return (options?.shellAvailable ?? defaultShellAvailable)();
}

function isWrapped(command: string, args: readonly string[]): boolean {
  return command === OOM_SCORE_WRAP_SHELL && args[0] === '-c' && args[1] === OOM_SCORE_WRAP_SCRIPT;
}

function canUseShellExecCommand(command: string): boolean {
  // dash 之类的 POSIX sh 不支持 `exec --`。开头带 '-' 的命令可能被当成 exec 选项，
  // 这种少见情形保留原路径直接 spawn，不做 wrap。
  return !command.startsWith('-');
}

function hardenShellEnv(baseEnv: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...(baseEnv ?? process.env) };
  for (const key of SHELL_INIT_ENV_KEYS) {
    delete next[key];
  }
  return next;
}

export function prepareOomScoreAdjustedSpawn(
  command: string,
  args: readonly string[] = [],
  options?: OomWrapOptions
): OomScoreAdjustedSpawn {
  const copy = [...args];
  if (!command || !canUseShellExecCommand(command) || !shouldWrapChildForOomScore(options)) {
    return { command, args: copy, env: options?.env, wrapped: false };
  }
  if (isWrapped(command, copy)) {
    return { command, args: copy, env: hardenShellEnv(options?.env), wrapped: true };
  }
  return {
    command: OOM_SCORE_WRAP_SHELL,
    args: ['-c', OOM_SCORE_WRAP_SCRIPT, command, ...copy],
    env: hardenShellEnv(options?.env),
    wrapped: true
  };
}

export function wrapArgvForChildOomScoreRaise(argv: readonly string[], options?: OomWrapOptions): string[] {
  const copy = [...argv];
  if (copy.length === 0) {
    return copy;
  }
  const spawn = prepareOomScoreAdjustedSpawn(copy[0] ?? '', copy.slice(1), options);
  return [spawn.command, ...spawn.args];
}

/**
 * 返回 `baseEnv` 在会被 wrap 时剥掉 shell-init keys 后的副本。
 * 未 wrap（非 Linux 或已 opt-out）时原样返回，保留精确的继承环境语义。
 */
export function hardenedEnvForChildOomWrap(
  baseEnv: NodeJS.ProcessEnv | undefined,
  options?: OomWrapOptions
): NodeJS.ProcessEnv | undefined {
  if (!shouldWrapChildForOomScore(options)) {
    return baseEnv;
  }
  return hardenShellEnv(baseEnv);
}
