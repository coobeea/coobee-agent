<script setup lang="ts">
/**
 * RemoteAccessSettings — 远程访问 / 手机扫码
 *
 * 展示局域网访问地址和二维码，方便用户通过手机控制 Agent。
 */

import { ref, onMounted } from 'vue';

interface NetworkInfo {
  host: string;
  port: number;
  localIPs: string[];
  primaryIP: string;
  isLanEnabled: boolean;
  baseUrl: string;
  qrDataUrl: string;
}

const networkInfo = ref<NetworkInfo | null>(null);
const loading = ref(true);
const error = ref('');
const copied = ref(false);

async function loadNetworkInfo(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    // TODO: 对接实际 API
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // 模拟数据
    networkInfo.value = {
      host: '0.0.0.0',
      port: 8765,
      localIPs: ['192.168.1.100', '127.0.0.1'],
      primaryIP: '192.168.1.100',
      isLanEnabled: true,
      baseUrl: 'http://192.168.1.100:8765',
      qrDataUrl: '' // 实际应用中这里会是 base64 图片
    };
  } catch (err: unknown) {
    console.error('[RemoteAccess] Failed to load network info:', err);
    error.value = '无法获取网络信息，请确认服务已启动';
  } finally {
    loading.value = false;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  }
}

async function copyUrl(): Promise<void> {
  if (!networkInfo.value?.baseUrl) return;
  const ok = await copyToClipboard(networkInfo.value.baseUrl);
  if (ok) {
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  }
}

onMounted(() => {
  loadNetworkInfo();
});
</script>

<template>
  <div class="h-full overflow-y-auto p-6 lg:p-10 bg-background text-foreground">
    <div class="mx-auto max-w-3xl">
      <h2 class="text-xl font-bold mb-2">远程访问</h2>
      <p class="text-sm text-muted-foreground mb-6">通过手机或其他设备扫码访问，远程控制你的 Agent</p>

      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-16">
        <span class="i-carbon-in-progress inline-block h-5 w-5 animate-spin text-muted-foreground"></span>
        <span class="ml-2 text-sm text-muted-foreground">加载网络信息...</span>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
        <span class="i-carbon-warning-alt inline-block h-8 w-8 text-destructive mb-2"></span>
        <p class="text-sm text-destructive">{{ error }}</p>
        <button
          class="mt-3 rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          @click="loadNetworkInfo">
          重试
        </button>
      </div>

      <!-- Content -->
      <template v-else-if="networkInfo">
        <!-- LAN Not Enabled Warning -->
        <div
          v-if="!networkInfo.isLanEnabled"
          class="mb-6 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 flex items-start gap-3">
          <span class="i-carbon-warning inline-block h-5 w-5 text-yellow-500 shrink-0 mt-0.5"></span>
          <div>
            <p class="text-sm font-medium text-foreground">局域网访问未开启</p>
            <p class="text-xs text-muted-foreground mt-1">
              当前服务绑定在 <code class="rounded bg-muted px-1 py-0.5">{{ networkInfo.host }}</code>，仅限本机访问。如需远程访问，请在 <code class="rounded bg-muted px-1 py-0.5">.env</code> 文件中设置
              <code class="rounded bg-muted px-1 py-0.5">VITE_SERVER_HOST=0.0.0.0</code> 后重启应用。
            </p>
          </div>
        </div>

        <!-- QR Code Section -->
        <section class="mb-6">
          <h3 class="text-sm font-semibold mb-4">扫码访问</h3>
          <div class="rounded-lg border border-border bg-card p-6">
            <div class="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
              <!-- QR Code -->
              <div class="shrink-0">
                <div v-if="networkInfo.qrDataUrl" class="rounded-xl border border-border bg-white p-3 shadow-sm">
                  <img :src="networkInfo.qrDataUrl" alt="远程访问二维码" class="h-48 w-48" />
                </div>
                <div
                  v-else
                  class="flex h-48 w-48 items-center justify-center rounded-xl border border-dashed border-border bg-muted/30">
                  <span class="i-carbon-qr-code text-4xl text-muted-foreground opacity-50"></span>
                </div>
              </div>

              <!-- Info -->
              <div class="flex-1 min-w-0 text-center sm:text-left">
                <p class="text-sm text-muted-foreground mb-4">使用手机浏览器扫描二维码，即可在移动端控制 Agent 对话</p>

                <!-- URL -->
                <div class="mb-4">
                  <label class="text-xs font-medium text-muted-foreground mb-1.5 block">访问地址</label>
                  <div class="flex items-center gap-2">
                    <code class="flex-1 rounded-md border border-border bg-muted px-3 py-2 text-sm font-mono text-foreground overflow-x-auto whitespace-nowrap">
                      {{ networkInfo.baseUrl }}
                    </code>
                    <button
                      @click="copyUrl"
                      class="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
                      :class="copied ? 'text-green-600 border-green-200 bg-green-50' : 'text-foreground'">
                      <span :class="copied ? 'i-carbon-checkmark' : 'i-carbon-copy'"></span>
                      {{ copied ? '已复制' : '复制' }}
                    </button>
                  </div>
                </div>

                <div class="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md border border-border/50">
                  <p class="flex items-center gap-1.5 mb-1 text-yellow-600 dark:text-yellow-500">
                    <span class="i-carbon-warning-alt"></span> 安全提示
                  </p>
                  <p>请确保您的设备连接在同一局域网（Wi-Fi）下。不要在公共网络环境中暴露此地址。</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
