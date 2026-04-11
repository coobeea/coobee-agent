/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * IPC 通信封装
 */

import { ref } from 'vue';

export function useIpc() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  /**
   * 发送 IPC 消息
   */
  function send(channel: string, ...args: any[]): void {
    try {
      window.electron.ipcRenderer.send(channel, ...args);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * 调用 IPC 方法并等待返回
   */
  async function invoke<T = any>(channel: string, ...args: any[]): Promise<T | null> {
    loading.value = true;
    error.value = null;

    try {
      const result = await window.electron.ipcRenderer.invoke(channel, ...args);
      return result;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 监听 IPC 消息
   */
  function on(channel: string, callback: (...args: any[]) => void): () => void {
    window.electron.ipcRenderer.on(channel, callback);

    // 返回取消监听函数
    return () => {
      window.electron.ipcRenderer.removeListener(channel, callback);
    };
  }

  return {
    loading,
    error,
    send,
    invoke,
    on
  };
}
