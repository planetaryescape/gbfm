import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    maxWorkers: 2,
    globalSetup: ['./src/test/d1-global-setup.ts'],
    include: ['src/**/*.d1.test.ts'],
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
})
