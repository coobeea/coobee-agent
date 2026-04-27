import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Enable SDK internal debug logging via the debug npm package
// Must be set before any module imports `debug`, or the logger stays disabled.
process.env.DEBUG = process.env.DEBUG || 'openai-agents*';
process.env.OPENAI_AGENTS_DONT_LOG_MODEL_DATA = process.env.OPENAI_AGENTS_DONT_LOG_MODEL_DATA || 'false';

const aliases = [
  { find: '@main', replacement: resolve(__dirname, 'src/main') },
  { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
  { find: '@renderer', replacement: resolve(__dirname, 'src/renderer/src') },
  { find: '@', replacement: resolve(__dirname, 'src/renderer/src') },
  { find: /^@electron-toolkit\/utils$/, replacement: resolve(__dirname, 'tests/mocks/electron-toolkit-utils.ts') },
  { find: /^electron$/, replacement: resolve(__dirname, 'tests/mocks/electron.ts') }
];

export default defineConfig({
  resolve: {
    alias: aliases
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [resolve(__dirname, 'tests/vitest.setup.ts')],
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/*.test.ts', 'src/**/types/**']
    },
    alias: aliases
  }
});
