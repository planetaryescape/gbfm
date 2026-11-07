import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

import { repoChangelogPlugin } from './plugins/repo-changelog.ts'

export default defineConfig({
  plugins: [repoChangelogPlugin()],
  resolve: {
    alias: {
      '@': resolve(fileURLToPath(new URL('.', import.meta.url)), 'src'),
    },
  },
  test: {
    include: ['plugins/**/*.test.ts', 'src/**/*.test.ts'],
  },
})
