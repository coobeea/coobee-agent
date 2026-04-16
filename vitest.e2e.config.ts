import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.e2e.test.ts'],
    testTimeout: 60000, // 60s timeout for E2E tests
    hookTimeout: 60000,
    alias: [
      { find: '@main', replacement: resolve(__dirname, 'src/main') },
      { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
      { find: '@renderer', replacement: resolve(__dirname, 'src/renderer/src') },
      { find: '@', replacement: resolve(__dirname, 'src/renderer/src') }
    ]
  }
});
