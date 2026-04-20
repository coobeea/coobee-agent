/**
 * Agent 导入导出工具类
 *
 * 负责智能体的导入和导出，使用标准 ZIP 包格式
 * 格式规范：docs/01-designs/04-agent-import-export-format.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import { createLogger } from '@main/common/logger';
import type { CreateAgentParams } from './types';
import type { AgentStore } from './AgentStore';
import type { AgentHomeManager } from './AgentHomeManager';

const log = createLogger('agent-import-export');

/** ZIP 包格式版本 */
const FORMAT_VERSION = '1.0';

/** 人格文件列表 */
const PERSONALITY_FILES = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'NOTES.md', 'HEARTBEAT.md', 'AGENTS.md'] as const;

/** 导入结果 */
export interface ImportResult {
  success: boolean;
  agentId?: string;
  agentName?: string;
  error?: string;
  warnings?: string[];
}

/** 导出配置 */
export interface ExportOptions {
  /** 是否包含技能文件 */
  includeSkills?: boolean;
  /** 是否包含会话记录 */
  includeSessions?: boolean;
}

/** Manifest 文件结构 */
interface Manifest {
  formatVersion: string;
  exportedAt: string;
  exportedBy: string;
  appVersion: string;
}

/** Agent 导出配置 */
interface AgentExportConfig {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model?: string;
  skills?: string[];
  excludeTools?: string[];
  createdBy: string;
  metadata?: Record<string, unknown>;
}

export class AgentImportExport {
  constructor(
    private readonly agentStore: AgentStore,
    private readonly homeManager: AgentHomeManager,
    private readonly appVersion: string
  ) {}

  /**
   * 导出智能体为 ZIP 文件
   *
   * @param agentId 智能体 ID
   * @param options 导出选项
   * @returns ZIP 文件路径
   */
  async exportAgent(agentId: string, options: ExportOptions = {}): Promise<string> {
    log.info(`[exportAgent] Starting export for agent: ${agentId}`);

    // 1. 获取智能体配置
    const agent = await this.agentStore.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // 2. 创建临时目录
    const tempDir = path.join(tmpdir(), `agent-export-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // 3. 写入 manifest.json
      const manifest: Manifest = {
        formatVersion: FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        exportedBy: 'coobee-agent',
        appVersion: this.appVersion
      };
      fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

      // 4. 写入 agent.json（移除时间戳和版本号，这些是运行时数据）
      const exportConfig: AgentExportConfig = {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        instructions: agent.instructions,
        model: agent.model,
        skills: agent.skills,
        excludeTools: agent.excludeTools,
        createdBy: agent.createdBy,
        metadata: agent.metadata
      };
      fs.writeFileSync(path.join(tempDir, 'agent.json'), JSON.stringify(exportConfig, null, 2), 'utf-8');

      // 5. 复制人格文件
      const homeDir = this.homeManager.getHomePath(agentId);
      if (fs.existsSync(homeDir)) {
        for (const file of PERSONALITY_FILES) {
          const srcPath = path.join(homeDir, file);
          if (fs.existsSync(srcPath)) {
            const content = fs.readFileSync(srcPath, 'utf-8');
            // 只复制非空且非纯模板的文件
            if (content.trim() && !this.isTemplateOnly(content)) {
              fs.copyFileSync(srcPath, path.join(tempDir, file));
              log.info(`[exportAgent] Copied ${file}`);
            }
          }
        }

        // 6. 复制技能目录（如果选项开启且目录存在）
        if (options.includeSkills) {
          const skillsDir = path.join(homeDir, 'skills');
          if (fs.existsSync(skillsDir)) {
            const skills = fs.readdirSync(skillsDir);
            if (skills.length > 0) {
              const targetSkillsDir = path.join(tempDir, 'skills');
              fs.cpSync(skillsDir, targetSkillsDir, { recursive: true });
              log.info(`[exportAgent] Copied ${skills.length} skills`);
            }
          }
        }
      }

      // 7. 打包成 ZIP
      const sanitizedName = this.sanitizeFilename(agent.name);
      const zipPath = path.join(tmpdir(), `${sanitizedName}.zip`);
      await this.zipDirectory(tempDir, zipPath);

      log.info(`[exportAgent] Export completed: ${zipPath}`);
      return zipPath;
    } finally {
      // 8. 清理临时目录
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }

  /**
   * 导入智能体 ZIP 文件
   *
   * @param zipPath ZIP 文件路径
   * @returns 导入结果
   */
  async importAgent(zipPath: string): Promise<ImportResult> {
    log.info(`[importAgent] Starting import from: ${zipPath}`);

    const warnings: string[] = [];
    let tempDir: string | null = null;

    try {
      // 1. 解压到临时目录
      tempDir = path.join(tmpdir(), `agent-import-${Date.now()}`);
      await this.unzipFile(zipPath, tempDir);

      // 2. 读取并验证 manifest.json
      const manifestPath = path.join(tempDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        return { success: false, error: '无效的 ZIP 包：缺少 manifest.json' };
      }

      const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (!this.isFormatVersionSupported(manifest.formatVersion)) {
        return {
          success: false,
          error: `不支持的格式版本: ${manifest.formatVersion}，当前支持版本: ${FORMAT_VERSION}`
        };
      }

      // 3. 读取并验证 agent.json
      const agentConfigPath = path.join(tempDir, 'agent.json');
      if (!fs.existsSync(agentConfigPath)) {
        return { success: false, error: '无效的 ZIP 包：缺少 agent.json' };
      }

      const agentConfig: AgentExportConfig = JSON.parse(fs.readFileSync(agentConfigPath, 'utf-8'));

      // 验证必填字段
      if (!agentConfig.name || !agentConfig.description) {
        return { success: false, error: 'agent.json 缺少必填字段: name 或 description' };
      }

      // 4. 处理 ID 冲突
      let finalAgentId = agentConfig.id;
      if (await this.agentStore.has(agentConfig.id)) {
        // 生成新 ID
        finalAgentId = this.generateUniqueId(agentConfig.name);
        warnings.push(`智能体 ID "${agentConfig.id}" 已存在，已重新生成为: ${finalAgentId}`);
        log.info(`[importAgent] ID conflict resolved: ${agentConfig.id} -> ${finalAgentId}`);
      }

      // 5. 创建智能体
      const createParams: CreateAgentParams = {
        id: finalAgentId,
        name: agentConfig.name,
        description: agentConfig.description,
        instructions: agentConfig.instructions || '你是一个智能助手。',
        model: agentConfig.model,
        skills: agentConfig.skills,
        excludeTools: agentConfig.excludeTools,
        createdBy: 'user', // 导入的智能体都标记为用户创建
        metadata: agentConfig.metadata
      };

      await this.agentStore.create(createParams);
      log.info(`[importAgent] Agent created: ${finalAgentId}`);

      // 6. 导入人格文件
      for (const file of PERSONALITY_FILES) {
        const filePath = path.join(tempDir, file);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          this.homeManager.writeFile(finalAgentId, file, content);
          log.info(`[importAgent] Imported ${file}`);
        }
      }

      // 7. 导入技能文件（如果存在）
      const skillsDir = path.join(tempDir, 'skills');
      if (fs.existsSync(skillsDir)) {
        const targetSkillsDir = path.join(this.homeManager.getHomePath(finalAgentId), 'skills');
        fs.cpSync(skillsDir, targetSkillsDir, { recursive: true });
        const skillCount = fs.readdirSync(skillsDir).length;
        log.info(`[importAgent] Imported ${skillCount} skills`);
        warnings.push(`已导入 ${skillCount} 个技能`);
      }

      log.info(`[importAgent] Import completed successfully`);
      return {
        success: true,
        agentId: finalAgentId,
        agentName: agentConfig.name,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    } catch (err) {
      log.error(`[importAgent] Import failed:`, err);
      return {
        success: false,
        error: err instanceof Error ? err.message : '导入失败：未知错误'
      };
    } finally {
      // 清理临时目录
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }

  /**
   * 将目录打包为 ZIP 文件
   */
  private async zipDirectory(sourceDir: string, zipPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const zip = new AdmZip();

        // 递归添加目录中的所有文件
        const addDirectory = (dir: string, zipDir: string = '') => {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const fullPath = path.join(dir, file);
            const zipPath = zipDir ? path.join(zipDir, file) : file;
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
              zip.addLocalFolder(fullPath, zipPath);
            } else {
              zip.addLocalFile(fullPath, zipDir);
            }
          }
        };

        addDirectory(sourceDir);
        zip.writeZip(zipPath);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * 解压 ZIP 文件
   */
  private async unzipFile(zipPath: string, targetDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(targetDir, true);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * 检查格式版本是否支持
   */
  private isFormatVersionSupported(version: string): boolean {
    // 目前只支持 1.0 版本
    return version === '1.0';
  }

  /**
   * 生成唯一的智能体 ID
   */
  private generateUniqueId(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9\-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);

    let id = `agent-${base}`;
    let counter = 1;

    // 如果 ID 已存在，添加数字后缀
    while (this.agentStore.has(id)) {
      id = `agent-${base}-${counter}`;
      counter++;
    }

    return id;
  }

  /**
   * 清理文件名（移除非法字符）
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);
  }

  /**
   * 判断文件内容是否仅包含模板注释（无实质内容）
   */
  private isTemplateOnly(content: string): boolean {
    const stripped = content
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('<!--') && !trimmed.endsWith('-->');
      })
      .join('')
      .trim();
    return stripped.length === 0;
  }
}
