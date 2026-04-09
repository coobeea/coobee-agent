import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import Icons from 'unplugin-icons/vite';
import IconsResolver from 'unplugin-icons/resolver';
import Components from 'unplugin-vue-components/vite';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

dotenv.config({ quiet: true });

function copyWasmAssetsPlugin(): Plugin {
  return {
    name: 'copy-wasm-assets',
    writeBundle() {
      const outDir = path.resolve(__dirname, 'out/main');
      const wasmFiles = [
        {
          src: path.resolve(__dirname, 'node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm'),
          dest: path.resolve(outDir, 'photon_rs_bg.wasm')
        }
      ];

      for (const { src, dest } of wasmFiles) {
        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
          console.log(`[copy-wasm] Copied ${path.basename(src)} to output directory`);
        } else {
          console.warn(`[copy-wasm] WASM file not found: ${src}`);
        }
      }
    }
  };
}

function copyLibsPlugin(): Plugin {
  return {
    name: 'copy-libs',
    writeBundle() {
      const sourceDir = path.resolve(__dirname, 'libs');
      const targetDir = path.resolve(__dirname, 'out/main/libs');

      if (!fs.existsSync(sourceDir)) {
        console.warn('[copy-libs] Source libs directory does not exist, skipping...');
        return;
      }

      fs.mkdirSync(targetDir, { recursive: true });
      fs.cpSync(sourceDir, targetDir, { recursive: true });

      const modules = fs.readdirSync(sourceDir).filter((item) => {
        return fs.statSync(path.join(sourceDir, item)).isDirectory();
      });

      console.log(`[copy-libs] Copied ${modules.length} modules from libs/ to output directory:`);
      modules.forEach((module) => console.log(`  - ${module}`));
    }
  };
}

export default defineConfig({
  main: {
    plugins: [copyLibsPlugin(), copyWasmAssetsPlugin()],
    resolve: {
      alias: {
        '@': resolve('src/main/'),
        '@main': resolve('src/main/'),
        '@shared': resolve('src/shared')
      }
    },
    define: {
      ...Object.keys(process.env).reduce(
        (acc, key) => {
          if (key.startsWith('VITE_') && process.env[key] !== undefined) {
            acc[`process.env.${key}`] = JSON.stringify(process.env[key]);
          }
          return acc;
        },
        {} as Record<string, string>
      )
    },
    build: {
      rollupOptions: {
        external: [
          'better-sqlite3-multiple-ciphers',
          'electron',
          'fs-ext',
          'node-pty',
          'bufferutil',
          'utf-8-validate',
          /\/__tests__\//,
          /\.test\.ts$/,
          /\.spec\.ts$/,
          'vitest'
        ],
        output: {
          inlineDynamicImports: true,
          manualChunks: undefined
        }
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@main': resolve('src/main/'),
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    optimizeDeps: {
      include: ['axios', 'dayjs', 'lodash']
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        vue: 'vue/dist/vue.esm-bundler.js'
      }
    },
    server: {
      host: '0.0.0.0',
      port: 5178
    },
    plugins: [
      tailwindcss(),
      // 自动导入 Vue 组件
      Components({
        dts: resolve('src/renderer/src/types/components.d.ts'),
        resolvers: [
          // 自动导入图标组件
          IconsResolver({
            prefix: 'icon'
          })
        ]
      }),
      // 图标插件
      Icons({
        compiler: 'vue3',
        autoInstall: true
      }),
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => tag.startsWith('custom-')
          }
        }
      })
    ],
    worker: {
      format: 'es'
    },
    build: {
      minify: 'esbuild',
      cssCodeSplit: false,
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          shell: resolve('src/renderer/shell.html'),
          browser: resolve('src/renderer/browser.html'),
          console: resolve('src/renderer/console.html')
        }
      }
    }
  }
});
