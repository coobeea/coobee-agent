import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import Icons from 'unplugin-icons/vite'
import IconsResolver from 'unplugin-icons/resolver'
import Components from 'unplugin-vue-components/vite'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@': resolve('src/main/'),
        '@main': resolve('src/main/'),
        '@shared': resolve('src/shared')
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
      port: 5173
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
    build: {
      minify: 'esbuild',
      cssCodeSplit: false
    }
  }
})
