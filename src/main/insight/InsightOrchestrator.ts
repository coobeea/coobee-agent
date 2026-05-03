import type { AnalysisSnapshot, AnalysisTemplate, InsightAnalysisTrigger, InsightSession } from '@shared/types/insight';
import { AgentStore } from '@main/agent/agents/AgentStore';
import { InsightAnalyzer } from './InsightAnalyzer';
import { SessionManager } from './SessionManager';
import { SnapshotStore } from './SnapshotStore';
import { TemplateStore } from './TemplateStore';

export class InsightOrchestrator {
  constructor(
    private readonly templateStore = new TemplateStore(),
    private readonly sessionManager = new SessionManager(),
    private readonly snapshotStore = new SnapshotStore(),
    private readonly analyzer = new InsightAnalyzer()
  ) {}

  async listTemplates(): Promise<AnalysisTemplate[]> {
    return this.templateStore.list();
  }

  async getTemplate(templateId: string): Promise<AnalysisTemplate> {
    return this.requireTemplate(templateId);
  }

  async createSession(params: {
    templateId: string;
    agentId?: string;
    initialText?: string;
    metadata?: Record<string, unknown>;
  }): Promise<InsightSession> {
    const template = await this.requireTemplate(params.templateId);
    const agent = await this.resolveAnalysisAgent(params.agentId);
    return this.sessionManager.create({
      templateId: template.id,
      templateName: template.name,
      config: {
        agentId: agent.id,
        agentName: agent.name
      },
      initialText: params.initialText,
      metadata: params.metadata
    });
  }

  async listActiveSessions(): Promise<InsightSession[]> {
    return this.sessionManager.listActive();
  }

  async listSessions(): Promise<InsightSession[]> {
    return this.sessionManager.list();
  }

  async getSession(sessionId: string): Promise<InsightSession> {
    return this.sessionManager.require(sessionId);
  }

  async appendText(sessionId: string, text: string): Promise<InsightSession> {
    return this.sessionManager.appendText(sessionId, text);
  }

  async appendTranscript(sessionId: string, text: string): Promise<InsightSession> {
    return this.sessionManager.appendTranscript(sessionId, text);
  }

  async analyzeSession(
    sessionId: string,
    trigger: InsightAnalysisTrigger = 'manual'
  ): Promise<{ session: InsightSession; snapshot: AnalysisSnapshot; usedFallback: boolean }> {
    const session = await this.sessionManager.require(sessionId);
    const template = await this.requireTemplate(session.templateId);

    if (!session.transcript.trim()) {
      throw new Error('当前会话还没有可分析的文本内容');
    }

    await this.sessionManager.updateStatus(sessionId, 'analyzing');

    const snapshots = await this.snapshotStore.list(sessionId);
    const previousSnapshot = snapshots[snapshots.length - 1];
    const previousLength = previousSnapshot?.fullTranscript.length ?? 0;
    const newText = session.transcript.slice(previousLength).trim() || session.transcript;

    const startedAt = Date.now();
    const analyzed = await this.analyzer.analyze(session, template, newText);
    const latencyMs = Date.now() - startedAt;

    const snapshot = await this.snapshotStore.create({
      sessionId,
      trigger,
      transcript: session.transcript,
      newText,
      result: analyzed.result,
      previousResult: previousSnapshot?.result,
      latencyMs
    });

    const updatedSession = await this.sessionManager.saveLatestResult(sessionId, analyzed.result);

    return {
      session: updatedSession,
      snapshot,
      usedFallback: analyzed.usedFallback
    };
  }

  async listSnapshots(sessionId: string): Promise<AnalysisSnapshot[]> {
    await this.sessionManager.require(sessionId);
    return this.snapshotStore.list(sessionId);
  }

  async completeSession(sessionId: string): Promise<InsightSession> {
    return this.sessionManager.updateStatus(sessionId, 'completed');
  }

  async pauseSession(sessionId: string): Promise<InsightSession> {
    return this.sessionManager.updateStatus(sessionId, 'paused');
  }

  async resumeSession(sessionId: string): Promise<InsightSession> {
    return this.sessionManager.updateStatus(sessionId, 'recording');
  }

  async createTemplate(params: {
    name: string;
    description: string;
    icon?: string;
    analysisPrompt?: string;
    refreshStrategy?: AnalysisTemplate['refreshStrategy'];
    dimensions: Array<{
      label: string;
      prompt: string;
      type?: AnalysisTemplate['dimensions'][number]['type'];
      options?: string[];
      maxItems?: number;
      showTrend?: boolean;
      required?: boolean;
    }>;
  }): Promise<AnalysisTemplate> {
    return this.templateStore.create(params);
  }

  async updateTemplate(
    templateId: string,
    params: {
      name: string;
      description: string;
      icon?: string;
      analysisPrompt?: string;
      refreshStrategy?: AnalysisTemplate['refreshStrategy'];
      dimensions: Array<{
        label: string;
        prompt: string;
        type?: AnalysisTemplate['dimensions'][number]['type'];
        options?: string[];
        maxItems?: number;
        showTrend?: boolean;
        required?: boolean;
      }>;
    }
  ): Promise<AnalysisTemplate> {
    return this.templateStore.update(templateId, params);
  }

  async deleteTemplate(templateId: string): Promise<void> {
    await this.templateStore.delete(templateId);
  }

  private async requireTemplate(templateId: string): Promise<AnalysisTemplate> {
    const template = await this.templateStore.get(templateId);
    if (!template) {
      throw new Error(`Insight template "${templateId}" not found`);
    }
    return template;
  }

  private async resolveAnalysisAgent(agentId?: string): Promise<{ id: string; name: string }> {
    const resolvedAgentId = typeof agentId === 'string' && agentId.trim() ? agentId.trim() : 'app-copilot';
    const agent = await AgentStore.getInstance().get(resolvedAgentId);
    if (!agent) {
      throw new Error(`Insight analysis agent "${resolvedAgentId}" not found`);
    }
    return {
      id: agent.id,
      name: agent.name
    };
  }
}
