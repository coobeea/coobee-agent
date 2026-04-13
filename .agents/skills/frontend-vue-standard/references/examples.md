# Frontend Vue Examples

## Master-Detail Layout (Settings Page)

This is a common pattern for settings pages: a list on the left, and details on the right.

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';

const items = ref([
  { id: '1', name: 'Item 1', enabled: true },
  { id: '2', name: 'Item 2', enabled: false },
]);

const selectedId = ref('1');

const selectedItem = computed(() => items.value.find(i => i.id === selectedId.value));

function selectItem(id: string) {
  selectedId.value = id;
}
</script>

<template>
  <div class="flex h-full bg-background text-foreground">
    <!-- Left Sidebar -->
    <div class="flex w-64 flex-col border-r border-border bg-card">
      <div class="p-4 border-b border-border">
        <h2 class="text-sm font-semibold">Items</h2>
      </div>
      
      <div class="flex-1 overflow-y-auto p-2">
        <button
          v-for="item in items"
          :key="item.id"
          class="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm mb-1 transition-colors text-left"
          :class="selectedId === item.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'"
          @click="selectItem(item.id)"
        >
          <span>{{ item.name }}</span>
          <span 
            class="w-2 h-2 rounded-full" 
            :class="item.enabled ? 'bg-green-500' : 'bg-gray-400'"
          ></span>
        </button>
      </div>
    </div>
    
    <!-- Right Content -->
    <div class="flex-1 overflow-y-auto p-6">
      <div v-if="selectedItem" class="max-w-2xl">
        <h1 class="text-2xl font-bold mb-6">{{ selectedItem.name }}</h1>
        
        <!-- Form Controls -->
        <div class="space-y-4">
          <!-- ... inputs ... -->
        </div>
      </div>
      <div v-else class="flex h-full items-center justify-center text-muted-foreground">
        Select an item to view details
      </div>
    </div>
  </div>
</template>
```
