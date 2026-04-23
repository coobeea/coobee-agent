/**
 * Agent Home 目录管理器
 *
 * 负责 Agent 持久化 Home 目录的初始化和管理：
 *   - 创建 homes/{agentId}/ 及其子目录
 *   - 生成默认人格文件（IDENTITY.md / SOUL.md / USER.md 等）
 *   - 读取 Agent Home 中的文件供注入系统提示词
 *
 * Agent Home 结构：
 *   .home/agents/{agentId}/
 *   ├── IDENTITY.md      身份名片
 *   ├── SOUL.md          人格与价值观
 *   ├── USER.md          主人档案
 *   ├── NOTES.md         环境工具备注
 *   ├── HEARTBEAT.md     心跳任务清单
 *   ├── AGENTS.md        Agent 级规则 + 技能配置
 *   ├── sessions.jsonl   会话索引（追加式）
 *   ├── memory/          Agent 级结构化记忆
 *   └── skills/          Agent 级专属技能
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@main/common/logger';

const log = createLogger('agent-home');

/** Agent Home 中的标准文件 */
const HOME_FILES = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'NOTES.md', 'HEARTBEAT.md', 'AGENTS.md', 'BOOTSTRAP.md'] as const;

/** 需要注入到 system prompt 的文件（按优先级排序） */
const INJECTABLE_FILES = ['BOOTSTRAP.md', 'IDENTITY.md', 'SOUL.md', 'USER.md', 'NOTES.md', 'HEARTBEAT.md', 'AGENTS.md'] as const;

/** 每个文件的用途说明（模板状态时展示） */
const FILE_PURPOSES: Record<string, string> = {
  'BOOTSTRAP.md': '引导文件：首次初始化配置',
  'IDENTITY.md': '身份名片：名字、风格、签名',
  'SOUL.md': '核心灵魂：行为原则、风格定调',
  'USER.md': '主人档案：用户称呼、偏好',
  'NOTES.md': '环境工具备注：特殊配置',
  'HEARTBEAT.md': '心跳任务清单：定期任务',
  'AGENTS.md': 'Agent 级规则与技能配置'
};

// ==================== 模板定义 ====================

function identityTemplate(): string {
  return `# Identity

<!-- 你的身份名片 -->
<!-- Name: (智能体的名字) -->
<!-- Vibe: (风格，如温和/严肃/活泼) -->
<!-- Emoji: (签名 emoji) -->
`;
}

function soulTemplate(): string {
  return `# Soul

<!-- 你的人格灵魂。核心原则、行为边界、风格定调。 -->
<!-- 这个文件定义了智能体的核心性格和行为准则。 -->
`;
}

function userTemplate(): string {
  return `# User

<!-- 主人档案：了解你的用户 -->
<!-- 称呼: (用户的称呼) -->
<!-- 主要用途: (使用场景) -->
<!-- 偏好: (用户偏好) -->
`;
}

function notesTemplate(): string {
  return `# Notes

<!-- 环境工具备注：记录当前环境的特殊配置 -->
<!-- 如 TTS 语音偏好、SSH 主机别名、常用路径等 -->
`;
}

function heartbeatTemplate(): string {
  return `# Heartbeat Tasks

<!-- 心跳任务清单：你定期需要检查和执行的事项 -->
<!-- 收到心跳轮询时，逐条检查并执行。文件为空则跳过。 -->
<!-- 格式：每行一个任务，用 - 开头 -->
`;
}

function agentsMdTemplate(): string {
  return `# Agent Rules

<!-- Agent 级规则：覆盖/补充全局规则 -->
<!-- 积累经验教训时在此添加规则 -->


<skills_system priority="1">
## Available Skills

<usage>
以下技能已为智能体配置并自动激活。使用技能时：
1. 根据 path 读取对应的 SKILL.md 获取完整指令
2. 按照 SKILL.md 中的说明执行操作
</usage>

<available_skills>
<!-- 技能配置示例： -->
<!--
<skill>
<name>skill-name</name>
<description>技能描述</description>
<path>../../../skills/skill-name/SKILL.md</path>
</skill>
-->
</available_skills>

</skills_system>
`;
}

function bootstrapTemplate(agentId: string): string {
  return `# Bootstrap

<!-- 首次引导文件 -->
<!-- Agent ID: ${agentId} -->
<!-- 此文件在首次初始化时自动创建，用于记录初始配置和引导信息 -->
<!-- 完成引导后可以删除此文件 -->

## 首次引导说明

这是您的 Agent 的首次引导文件。请根据需要填写以下配置：

1. 在 IDENTITY.md 中定义 Agent 的身份和风格
2. 在 SOUL.md 中设置核心行为原则
3. 在 USER.md 中记录用户偏好
4. 在 NOTES.md 中添加环境配置说明
5. 在 HEARTBEAT.md 中设置定期任务
6. 在 AGENTS.md 中配置技能和规则

完成配置后，此文件会在系统提示词中注入，您可以在适当时候删除它。
`;
}

const TEMPLATES: Record<string, (agentId?: string) => string> = {
  'IDENTITY.md': identityTemplate,
  'SOUL.md': soulTemplate,
  'USER.md': userTemplate,
  'NOTES.md': notesTemplate,
  'HEARTBEAT.md': heartbeatTemplate,
  'AGENTS.md': agentsMdTemplate,
  'BOOTSTRAP.md': (agentId) => bootstrapTemplate(agentId || 'unknown')
};

// ==================== AgentHomeManager ====================

export class AgentHomeManager {
  private readonly homesDir: string;

  constructor(homesDir: string) {
    this.homesDir = homesDir;
  }

  /**
   * 初始化指定 Agent 的 Home 目录
   *
   * 如果目录已存在，不会覆盖已有文件。
   * 仅在文件缺失时写入默认模板。
   * 
   * BOOTSTRAP.md 只在首次初始化时创建（即其他标准文件都不存在时）。
   */
  initHome(agentId: string): string {
    const homeDir = path.join(this.homesDir, agentId);
    const memoryDir = path.join(homeDir, 'memory');
    const skillsDir = path.join(homeDir, 'skills');

    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.mkdirSync(skillsDir, { recursive: true });

    // 检查是否是首次初始化（除 BOOTSTRAP.md 外的标准文件都不存在）
    const standardFiles = HOME_FILES.filter(f => f !== 'BOOTSTRAP.md');
    const hasExistingFiles = standardFiles.some(file => 
      fs.existsSync(path.join(homeDir, file))
    );

    // 写入缺失的标准文件
    for (const file of HOME_FILES) {
      const filePath = path.join(homeDir, file);
      
      // BOOTSTRAP.md 只在首次初始化时创建
      if (file === 'BOOTSTRAP.md' && hasExistingFiles) {
        continue;
      }
      
      if (!fs.existsSync(filePath)) {
        const templateFn = TEMPLATES[file];
        if (templateFn) {
          fs.writeFileSync(filePath, templateFn(agentId), 'utf-8');
        }
      }
    }

    log.info(`[AgentHomeManager] Initialized home for agent: ${agentId}`);
    return homeDir;
  }

  /**
   * 批量初始化多个 Agent 的 Home 目录
   */
  initHomes(agentIds: string[]): void {
    fs.mkdirSync(this.homesDir, { recursive: true });
    for (const id of agentIds) {
      try {
        this.initHome(id);
      } catch (err) {
        log.warn(`[AgentHomeManager] Failed to init home for ${id}:`, err);
      }
    }
  }

  /**
   * 检查 Agent Home 是否存在
   */
  hasHome(agentId: string): boolean {
    return fs.existsSync(path.join(this.homesDir, agentId));
  }

  /**
   * 获取 Agent Home 目录路径（不自动创建）
   */
  getHomePath(agentId: string): string {
    return path.join(this.homesDir, agentId);
  }

  /**
   * 读取 Agent Home 中需要注入到 system prompt 的文件
   *
   * @param agentId Agent ID
   * @returns XML 包裹的文件内容块，或 undefined
   */
  readInjectableFiles(agentId: string): string | undefined {
    const homeDir = path.join(this.homesDir, agentId);
    if (!fs.existsSync(homeDir)) return undefined;

    const sections: string[] = [];

    for (const file of INJECTABLE_FILES) {
      const filePath = path.join(homeDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (!content) continue;
        if (isTemplateOnly(content)) {
          const purpose = FILE_PURPOSES[file] || '待填写';
          sections.push(`### ${file} (${filePath})\n\n_[${purpose} — 尚未填写]_`);
        } else {
          sections.push(`### ${file} (${filePath})\n\n${content}`);
        }
      } catch {
        // 文件不存在或无法读取
      }
    }

    if (sections.length === 0) return undefined;

    let merged = sections.join('\n\n---\n\n');
    const maxLen = 10000;
    if (merged.length > maxLen) {
      merged = merged.slice(0, maxLen) + '\n\n... (truncated)';
    }

    return `<agent_home agentId="${agentId}" path="${homeDir}">
These are YOUR persistent identity and memory files.

${merged}
</agent_home>`;
  }

  /**
   * 读取 Agent 级 AGENTS.md
   */
  readAgentsMd(agentId: string): string | undefined {
    const filePath = path.join(this.homesDir, agentId, 'AGENTS.md');
    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (content && !isTemplateOnly(content)) return content;
    } catch {
      // 文件不存在
    }
    return undefined;
  }

  /**
   * 读取指定人格文件
   */
  readFile(agentId: string, fileName: string): string | undefined {
    const filePath = path.join(this.homesDir, agentId, fileName);
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  /**
   * 写入指定人格文件
   */
  writeFile(agentId: string, fileName: string, content: string): void {
    const homeDir = path.join(this.homesDir, agentId);
    if (!fs.existsSync(homeDir)) {
      this.initHome(agentId);
    }
    const filePath = path.join(homeDir, fileName);
    fs.writeFileSync(filePath, content, 'utf-8');
    log.info(`[AgentHomeManager] Updated ${fileName} for agent: ${agentId}`);
  }

  /**
   * 读取所有人格文件
   */
  readAllFiles(agentId: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const file of HOME_FILES) {
      const content = this.readFile(agentId, file);
      if (content !== undefined) {
        result[file] = content;
      }
    }
    return result;
  }

  /**
   * 删除 Agent Home 目录
   */
  deleteHome(agentId: string): void {
    const homeDir = path.join(this.homesDir, agentId);
    if (fs.existsSync(homeDir)) {
      fs.rmSync(homeDir, { recursive: true, force: true });
      log.info(`[AgentHomeManager] Deleted home for agent: ${agentId}`);
    }
  }

  /**
   * 读取 Agent 的 sessions.jsonl 索引
   *
   * @param agentId Agent ID
   * @returns Session 索引列表（id + createdAt），按创建时间顺序
   */
  readSessionIndex(agentId: string): Array<{ id: string; createdAt: string }> {
    const indexPath = path.join(this.homesDir, agentId, 'sessions.jsonl');

    if (!fs.existsSync(indexPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.trim());

      return lines
        .map((line) => {
          try {
            return JSON.parse(line) as { id: string; createdAt: string };
          } catch {
            log.warn(`[AgentHomeManager] Invalid JSON line in ${agentId}/sessions.jsonl: ${line}`);
            return null;
          }
        })
        .filter((entry): entry is { id: string; createdAt: string } => entry !== null);
    } catch (err) {
      log.warn(`[AgentHomeManager] Failed to read session index for ${agentId}:`, err);
      return [];
    }
  }
}

/**
 * 判断文件内容是否仅包含模板注释（无实质内容）
 */
function isTemplateOnly(content: string): boolean {
  const withoutDefaultSkillBlock = content.replace(/<skills_system\b[^>]*>[\s\S]*?<\/skills_system>/g, '');
  const stripped = withoutDefaultSkillBlock
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('<!--') && !trimmed.endsWith('-->');
    })
    .join('')
    .trim();
  return stripped.length === 0;
}
