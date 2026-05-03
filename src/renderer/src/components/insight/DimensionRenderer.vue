<script setup lang="ts">
import type { DimensionChange, DimensionValue } from '@shared/types/insight';

const props = defineProps<{
  dimension: DimensionValue;
  change?: DimensionChange;
  icon?: string;
  showTrend?: boolean;
  plain?: boolean;
}>();

function getTrendIcon(direction?: string): string {
  switch (direction) {
    case 'up':
      return '↑';
    case 'down':
      return '↓';
    case 'stable':
      return '→';
    case 'changed':
      return '⟳';
    default:
      return '';
  }
}

function getEnumBadgeClass(value: unknown): string {
  const s = String(value);
  if (['强烈', '优秀', '高', '强烈推荐', '推荐', '推进'].includes(s)) return 'bg-success/12 text-success';
  if (['偏强', '良好', '中', '澄清', '开场'].includes(s)) return 'bg-info/12 text-info';
  if (['一般', '待定', '收尾'].includes(s)) return 'bg-warning/12 text-warning';
  if (['观望', '较差', '低', '不推荐', '拒绝', '阻塞'].includes(s)) return 'bg-destructive/12 text-destructive';
  return 'bg-muted text-muted-foreground';
}

function isIconClass(icon?: string): boolean {
  return Boolean(icon && icon.startsWith('i-carbon-'));
}
</script>

<template>
  <div
    class="group px-4 py-4 transition-all"
    :class="
      props.plain
        ? 'rounded-none border-0 bg-transparent shadow-none'
        : 'rounded-2xl border border-border/70 bg-background/74 shadow-[0_12px_32px_-20px_rgba(0,0,0,0.24)] backdrop-blur-sm hover:border-primary/20 hover:bg-background/88 hover:shadow-[0_18px_38px_-24px_rgba(0,0,0,0.26)]'
    ">
    <div v-if="!props.plain" class="mb-3 flex items-start gap-3">
      <div
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/12 bg-primary/8 text-foreground/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
        <span v-if="isIconClass(props.icon)" :class="props.icon" class="inline-block h-4 w-4" />
        <span v-else-if="props.icon" class="text-base">{{ props.icon }}</span>
        <span v-else class="i-carbon-chart-line-data inline-block h-4 w-4" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
            {{ props.dimension.type }}
          </span>
          <span
            v-if="props.showTrend && props.change"
            class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            :class="{
              'bg-success/10 text-success': props.change.direction === 'up',
              'bg-destructive/10 text-destructive': props.change.direction === 'down',
              'bg-muted text-muted-foreground':
                props.change.direction === 'stable' || props.change.direction === 'changed'
            }">
            {{ getTrendIcon(props.change.direction) }}
          </span>
        </div>
        <h3 class="mt-1 text-sm font-semibold text-foreground/92">{{ props.dimension.label }}</h3>
      </div>
      <span
        class="shrink-0 rounded-full border border-border/70 bg-surface/82 px-2.5 py-1 text-[10px] font-medium text-muted-foreground/80">
        {{ props.dimension.key }}
      </span>
    </div>
    <div class="text-sm text-foreground/86">
      <template v-if="props.dimension.type === 'enum'">
        <span
          class="inline-flex min-h-8 items-center rounded-full px-3 py-1 text-xs font-semibold shadow-sm"
          :class="getEnumBadgeClass(props.dimension.value)">
          {{ props.dimension.value }}
        </span>
      </template>

      <template v-else-if="props.dimension.type === 'score'">
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-muted-foreground">当前评分</span>
            <span class="text-sm font-semibold text-info">{{ props.dimension.value }}</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-muted/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]">
            <div
              class="h-full rounded-full bg-info shadow-[0_0_24px_hsl(var(--primary)/0.28)] transition-all duration-300"
              :style="{ width: `${Number(props.dimension.value) || 0}%` }" />
          </div>
        </div>
      </template>

      <template v-else-if="props.dimension.type === 'text'">
        <p class="leading-7 text-foreground/90">{{ props.dimension.value || '—' }}</p>
      </template>

      <template v-else-if="props.dimension.type === 'list'">
        <ul
          v-if="Array.isArray(props.dimension.value) && (props.dimension.value as string[]).length"
          class="space-y-2 text-sm">
          <li
            v-for="(item, i) in props.dimension.value as string[]"
            :key="i"
            class="flex items-start gap-2 rounded-xl border border-border/50 bg-surface/68 px-3 py-2 text-foreground/90">
            <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
            <span class="leading-6">{{ item }}</span>
          </li>
        </ul>
        <span v-else class="text-xs text-muted-foreground/50">暂无数据</span>
      </template>

      <template v-else-if="props.dimension.type === 'tags'">
        <div
          v-if="Array.isArray(props.dimension.value) && (props.dimension.value as string[]).length"
          class="flex flex-wrap gap-1.5">
          <span
            v-for="(tag, i) in props.dimension.value as string[]"
            :key="i"
            class="rounded-full border border-border/70 bg-surface/82 px-2.5 py-1 text-[11px] font-medium text-muted-foreground/82">
            {{ tag }}
          </span>
        </div>
        <span v-else class="text-xs text-muted-foreground/50">暂无</span>
      </template>

      <template v-else-if="props.dimension.type === 'progress'">
        <span
          class="inline-flex min-h-8 items-center rounded-full bg-info/12 px-3 py-1 text-xs font-semibold text-info">
          {{ props.dimension.value || '—' }}
        </span>
      </template>

      <template v-else-if="props.dimension.type === 'boolean'">
        <span
          class="inline-flex min-h-8 items-center rounded-full px-3 py-1 text-xs font-semibold"
          :class="props.dimension.value ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'">
          {{ props.dimension.value ? '已达成' : '未达成' }}
        </span>
      </template>

      <template v-else>
        <span>{{ props.dimension.value ?? '—' }}</span>
      </template>
    </div>
  </div>
</template>
