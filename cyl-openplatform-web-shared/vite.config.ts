import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'jsdom', setupFiles: ['./src/testing/setup.ts'] } });
