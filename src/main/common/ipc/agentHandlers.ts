import { ipcMain } from 'electron';
import { agentExecutor } from '@main/agent/AgentExecutor';
import { AgentChannels } from '@shared/ipc/channels';

export function registerAgentHandlers(): void {
  ipcMain.handle(AgentChannels.SUBMIT, async (_event, { sessionId, message }: { sessionId: string; message: string }) => {
    // 使用 PiMonoBuilder 作为默认
    const builder = agentExecutor.piMono().instructions('You are a helpful assistant.');
    
    // 提交执行请求
    const result = agentExecutor.submit({
      sessionId,
      message,
      builder
    });
    
    return result;
  });
}
