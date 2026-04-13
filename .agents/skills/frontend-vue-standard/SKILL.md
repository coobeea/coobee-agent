---
name: Frontend Vue Development Standard
description: Standard workflow and best practices for developing Vue 3 frontend components in the coobee-agent project. Use when creating or modifying Vue components, views, or layouts. Enforces Vue 3 Composition API (<script setup>), Tailwind CSS for styling, semantic color variables (bg-background, text-foreground), and Carbon Icons (i-carbon-*).
---

# Frontend Vue Development Standard

Standard workflow for developing Vue 3 frontend components in the coobee-agent project.

## Core Principles

1. **Vue 3 Composition API** - Always use `<script setup lang="ts">`
2. **Tailwind CSS** - Use utility classes for styling, avoid custom `<style>` blocks when possible
3. **Semantic Colors** - Use CSS variables for colors (e.g., `bg-background`, `text-foreground`, `border-border`, `bg-card`) to support light/dark modes
4. **Carbon Icons** - Use Unocss Carbon icons (e.g., `i-carbon-settings`)
5. **Type Safety** - Use TypeScript for all props, emits, and state

## Directory Structure

```
src/renderer/src/
├── components/          # Reusable UI components
├── views/               # Page-level components
│   ├── SettingsView.vue # Main view container
│   └── settings/        # Sub-views for specific domains
│       └── ProviderSettings.vue
├── layout/              # Application layouts
├── api/                 # API clients
└── router/              # Vue Router configuration
```

## Component Structure

Always structure Vue components in this order:

1. `<script setup lang="ts">`
2. `<template>`
3. `<style scoped>` (Only if necessary)

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';
import type { UserVO } from '@shared/api/user-types';

// Props & Emits
const props = defineProps<{
  user: UserVO;
  isActive?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update', id: string): void;
}>();

// State
const loading = ref(false);

// Computed
const displayName = computed(() => props.user.name || 'Unknown');

// Methods
async function handleUpdate() {
  loading.value = true;
  try {
    emit('update', props.user.id);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div 
    class="flex items-center p-4 rounded-lg border border-border"
    :class="isActive ? 'bg-primary/10 text-primary' : 'bg-card text-foreground'"
  >
    <span class="i-carbon-user w-5 h-5 mr-3"></span>
    <div class="flex-1">
      <h3 class="text-sm font-medium">{{ displayName }}</h3>
      <p class="text-xs text-muted-foreground">{{ user.email }}</p>
    </div>
    <button 
      class="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
      :disabled="loading"
      @click="handleUpdate"
    >
      {{ loading ? 'Saving...' : 'Save' }}
    </button>
  </div>
</template>
```

## UI Best Practices

### Layouts
- Use Flexbox (`flex`, `flex-col`, `items-center`, `justify-between`) for alignments.
- Use Grid (`grid`, `grid-cols-*`, `gap-*`) for structured layouts.
- Use `h-full`, `w-full`, `flex-1`, `overflow-hidden`, `overflow-y-auto` for full-screen application layouts.

### Typography
- Use `text-sm`, `text-xs`, `text-base` for standard sizing.
- Use `font-medium`, `font-semibold`, `font-bold` for emphasis.

### Colors
Always use semantic colors from the theme (do not use hardcoded colors like `bg-white` or `text-black` unless absolutely necessary):
- Backgrounds: `bg-background`, `bg-card`, `bg-muted`
- Text: `text-foreground`, `text-muted-foreground`, `text-primary`
- Borders: `border-border`
- Accents: `bg-primary text-primary-foreground`

### Icons
Use the `i-carbon-*` prefix for icons. Add `w-4 h-4 inline-block` or similar sizing classes.
Example: `<span class="i-carbon-settings w-4 h-4"></span>`

## Detailed Guidelines

For comprehensive guidelines including state management, API integration, and complex layouts, see:
- [references/detailed-guidelines.md](references/detailed-guidelines.md)
- [references/examples.md](references/examples.md)
