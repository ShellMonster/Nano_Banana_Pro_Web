import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // 代码分割优化：将大型依赖分离到独立 chunk
    rollupOptions: {
      output: {
        manualChunks: {
          // React 核心
          'vendor-react': ['react', 'react-dom'],
          // 状态管理和数据请求
          'vendor-data': ['zustand', '@tanstack/react-query'],
          // 国际化
          'vendor-i18n': ['i18next', 'react-i18next'],
          // 工具库
          'vendor-utils': ['clsx', 'tailwind-merge'],
          // 虚拟列表
          'vendor-virtual': ['react-window', 'react-virtualized-auto-sizer'],
        },
      },
    },
    // 提高 chunk 大小警告阈值
    chunkSizeWarningLimit: 600,
  },
})
