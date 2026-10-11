import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  build: { rollupOptions: { input: {
    main: 'index.html',
    login: 'login.html',
    // 106/107 组件展示页：静态示例数据，仅在本机回环地址或开发模式显示内容。
    uiKit: 'ui-kit.html',
  } } },
  server: { host: '127.0.0.1', proxy: {
    '/admin-api': 'http://127.0.0.1:18080',
    '/platform-info': 'http://127.0.0.1:18080',
    '/api': 'http://127.0.0.1:18080',
    '/public-api': 'http://127.0.0.1:18080',
    '/portal': 'http://127.0.0.1:18080',
    '/docs': 'http://127.0.0.1:18080',
    '/auth': 'http://127.0.0.1:18080',
  } },
  test: { maxWorkers: 4, environment: 'jsdom', setupFiles: ['../cyl-openplatform-web-shared/src/testing/setup.ts'] },
});
