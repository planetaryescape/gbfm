import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    maxWorkers: 2,
    include: ['src/**/*.d1.test.ts'],
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
})
