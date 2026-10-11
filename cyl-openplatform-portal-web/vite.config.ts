import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/portal/',
  plugins: [react()],
  server: { host: '127.0.0.1', proxy: {
    '/platform-info': 'http://127.0.0.1:18080',
    '/public-api': 'http://127.0.0.1:18080',
    '/portal-api': 'http://127.0.0.1:18080',
    '/api': 'http://127.0.0.1:18080',
    '/auth': 'http://127.0.0.1:18080',
  } },
  test: { maxWorkers: 4, environment: 'jsdom', setupFiles: ['../cyl-openplatform-web-shared/src/testing/setup.ts'] },
});
