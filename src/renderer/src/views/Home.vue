<script setup lang="ts">
import { useAppStore } from '@/stores/app'
import Versions from '@/components/Versions.vue'

const appStore = useAppStore()

const ipcHandle = () => window.electron.ipcRenderer.send('ping')
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center p-8">
    <img alt="logo" class="w-32 h-32 mb-4" src="../assets/electron.svg" />
    
    <div class="text-center space-y-4">
      <h1 class="text-3xl font-bold text-gray-900 dark:text-white">
        Powered by electron-vite
      </h1>
      
      <p class="text-lg text-gray-600 dark:text-gray-300">
        Build an Electron app with
        <span class="text-blue-500 font-semibold">Vue 3</span>
        and
        <span class="text-blue-500 font-semibold">TypeScript</span>
      </p>
      
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Please try pressing <code class="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">F12</code> to open the devTool
      </p>
      
      <div class="flex gap-4 justify-center mt-6">
        <a 
          href="https://electron-vite.org/" 
          target="_blank" 
          rel="noreferrer"
          class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
        >
          Documentation
        </a>
        <button
          @click="ipcHandle"
          class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition"
        >
          Send IPC
        </button>
        <button
          @click="appStore.toggleTheme"
          class="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 transition"
        >
          Toggle Theme
        </button>
      </div>
    </div>
    
    <Versions class="mt-8" />
  </div>
</template>
