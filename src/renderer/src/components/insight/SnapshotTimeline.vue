<script setup lang="ts">
import type { AnalysisSnapshot } from '@shared/types/insight';

const props = defineProps<{
  snapshots: AnalysisSnapshot[];
  activeSnapshotId?: string;
  activeSequence?: number;
}>();

const emit = defineEmits<{
  (e: 'select', snapshotId: string): void;
}>();

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<template>
  <div class="shrink-0 border-t border-border/60 bg-card/68 px-5 py-3 backdrop-blur-sm">
    <div class="mb-3 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <div
          class="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-accent/10 text-accent">
          <span class="i-carbon-timer inline-block h-3.5 w-3.5" />
        </div>
        <h3 class="text-xs font-bold tracking-wide text-foreground/70">分析时间线</h3>
      </div>
      <span
        class="rounded-full border border-border/70 bg-background/70 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground/70">
        {{ props.snapshots.length }} 次分析
      </span>
    </div>

    <div class="flex gap-2 overflow-x-auto pb-1">
      <button
        v-for="snapshot in props.snapshots"
        :key="snapshot.id"
        class="group flex min-w-[120px] shrink-0 flex-col items-start gap-2 rounded-xl border px-3.5 py-3 text-left transition-all"
        :class="
          snapshot.id === props.activeSnapshotId || snapshot.sequence === props.activeSequence
            ? 'border-primary/25 bg-primary/7 shadow-[0_10px_24px_-18px_hsl(var(--primary)/0.25)]'
            : 'border-border/70 bg-background/85 hover:border-primary/20 hover:bg-background'
        "
        :title="`#${snapshot.sequence} ${formatTime(snapshot.timestamp)} (${snapshot.latencyMs}ms)`"
        type="button"
        @click="emit('select', snapshot.id)">
        <div class="flex w-full items-center justify-between gap-2">
          <span
            class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            :class="
              snapshot.id === props.activeSnapshotId || snapshot.sequence === props.activeSequence
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface/90 text-foreground/75'
            ">
            #{{ snapshot.sequence }}
          </span>
          <span class="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/50">{{ snapshot.trigger }}</span>
        </div>
        <div>
          <p class="text-[11px] font-medium text-foreground/88">{{ formatTime(snapshot.timestamp) }}</p>
          <p class="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground/80">
            {{ snapshot.result.summary || '暂无摘要' }}
          </p>
        </div>
      </button>

      <div
        v-if="props.snapshots.length === 0"
        class="flex min-h-[88px] min-w-full items-center justify-center rounded-xl border border-dashed border-border/70 bg-background/70 text-xs text-muted-foreground/50">
        尚无分析快照
      </div>
    </div>
  </div>
</template>
