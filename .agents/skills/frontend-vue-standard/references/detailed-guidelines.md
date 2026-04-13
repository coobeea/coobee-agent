# Frontend Vue Detailed Guidelines

## State Management

### Local State
Use `ref` for primitives and `reactive` for complex objects.

```typescript
const count = ref(0);
const form = reactive({
  name: '',
  email: ''
});
```

### API Integration
Always handle loading and error states when calling APIs.

```typescript
import { ref, onMounted } from 'vue';
import { getProviders } from '@/api/config';
import type { ProviderConfig } from '@shared/api/config-types';

const providers = ref<Record<string, ProviderConfig>>({});
const loading = ref(true);
const error = ref<string | null>(null);

async function loadData() {
  loading.value = true;
  error.value = null;
  
  try {
    const result = await getProviders();
    if (result.success && result.data) {
      providers.value = result.data.providers;
    } else {
      error.value = result.error || 'Failed to load data';
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadData();
});
```

## Dynamic Components

For settings pages or tabs, use `<component :is="...">` with `shallowRef` and `markRaw` to avoid unnecessary reactivity overhead.

```typescript
import { shallowRef, markRaw } from 'vue';
import BasicSettings from './BasicSettings.vue';
import AdvancedSettings from './AdvancedSettings.vue';

const tabs = [
  { id: 'basic', label: 'Basic', component: markRaw(BasicSettings) },
  { id: 'advanced', label: 'Advanced', component: markRaw(AdvancedSettings) }
];

const activeComponent = shallowRef(tabs[0].component);
```

## Forms and Inputs

Style inputs consistently using Tailwind.

```vue
<template>
  <div class="flex flex-col gap-1.5">
    <label class="text-sm font-medium text-foreground">API Key</label>
    <input 
      type="password" 
      v-model="apiKey"
      class="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
      placeholder="Enter API Key"
    />
    <p class="text-xs text-muted-foreground">Your API key is stored securely.</p>
  </div>
</template>
```
