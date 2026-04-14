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
  <div class="h-full overflow-y-auto p-8 lg:p-12 bg-background text-foreground">
    <div class="mx-auto max-w-3xl">
      <h2 class="text-2xl font-bold tracking-tight mb-2">远程访问</h2>
      <p class="text-sm text-muted-foreground mb-8">通过手机或其他设备扫码访问，远程控制你的 Agent</p>

      <!-- Loading -->
      <div v-if="loading" class="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <span class="i-carbon-circle-dash mb-4 text-5xl animate-spin text-primary/70"></span>
        <span class="text-base font-medium">加载网络信息中...</span>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center shadow-sm">
        <span class="i-carbon-warning-alt inline-block h-10 w-10 text-destructive mb-3"></span>
        <p class="text-sm font-medium text-destructive mb-4">{{ error }}</p>
        <button
          class="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
          @click="loadNetworkInfo">
          重试
        </button>
      </div>

      <!-- Content -->
      <template v-else-if="networkInfo">
        <!-- LAN Not Enabled Warning -->
        <div
          v-if="!networkInfo.isLanEnabled"
          class="mb-8 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-5 flex items-start gap-4 shadow-sm">
          <span class="i-carbon-warning inline-block h-6 w-6 text-yellow-600 dark:text-yellow-500 shrink-0 mt-0.5"></span>
          <div>
            <p class="text-base font-semibold text-yellow-800 dark:text-yellow-400 mb-1">局域网访问未开启</p>
            <p class="text-sm text-yellow-700/80 dark:text-yellow-500/80 leading-relaxed">
              当前服务绑定在 <code class="rounded-md bg-yellow-500/20 px-1.5 py-0.5 font-mono text-xs border border-yellow-500/30">{{ networkInfo.host }}</code>，仅限本机访问。如需远程访问，请在 <code class="rounded-md bg-yellow-500/20 px-1.5 py-0.5 font-mono text-xs border border-yellow-500/30">.env</code> 文件中设置
              <code class="rounded-md bg-yellow-500/20 px-1.5 py-0.5 font-mono text-xs border border-yellow-500/30">VITE_SERVER_HOST=0.0.0.0</code> 后重启应用。
            </p>
          </div>
        </div>

        <!-- QR Code Section -->
        <section class="mb-8">
          <h3 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">扫码访问</h3>
          <div class="rounded-xl border border-border bg-card p-8 shadow-sm">
            <div class="flex flex-col items-center gap-8 sm:flex-row sm:items-start">
              <!-- QR Code -->
              <div class="shrink-0">
                <div v-if="networkInfo.qrDataUrl" class="rounded-2xl border border-border bg-white p-4 shadow-sm">
                  <img :src="networkInfo.qrDataUrl" alt="远程访问二维码" class="h-48 w-48" />
                </div>
                <div
                  v-else
                  class="flex h-56 w-56 items-center justify-center rounded-2xl border-2 border-dashed border-border bg-muted/30">
                  <div class="text-center">
                    <span class="i-carbon-qr-code text-5xl text-muted-foreground opacity-30 mb-2 block mx-auto"></span>
                    <span class="text-xs text-muted-foreground font-medium">暂无二维码</span>
                  </div>
                </div>
              </div>

              <!-- Info -->
              <div class="flex-1 min-w-0 text-center sm:text-left w-full">
                <p class="text-base text-foreground font-medium mb-6">使用手机浏览器扫描二维码，即可在移动端控制 Agent 对话</p>

                <!-- URL -->
                <div class="mb-6">
                  <label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">访问地址</label>
                  <div class="flex items-center gap-3">
                    <code class="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-mono text-foreground overflow-x-auto whitespace-nowrap shadow-sm">
                      {{ networkInfo.baseUrl }}
                    </code>
                    <button
                      @click="copyUrl"
                      class="flex shrink-0 items-center gap-2 rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors shadow-sm"
                      :class="copied ? 'text-green-600 border-green-200 bg-green-50 dark:bg-green-500/10 dark:border-green-500/20' : 'text-foreground'">
                      <span :class="copied ? 'i-carbon-checkmark' : 'i-carbon-copy'"></span>
                      {{ copied ? '已复制' : '复制地址' }}
                    </button>
                  </div>
                </div>

                <div class="text-sm text-muted-foreground bg-muted/50 p-4 rounded-lg border border-border/50">
                  <p class="flex items-center gap-2 mb-1.5 font-medium text-yellow-600 dark:text-yellow-500">
                    <span class="i-carbon-warning-alt text-lg"></span> 安全提示
                  </p>
                  <p class="leading-relaxed">请确保您的设备连接在同一局域网（Wi-Fi）下。不要在公共网络环境中暴露此地址，以免造成数据泄露。</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
