import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __DEV__: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'expo-crypto': fileURLToPath(new URL('./src/test/expo-crypto.ts', import.meta.url)),
      'expo-secure-store': fileURLToPath(
        new URL('./src/test/expo-secure-store.ts', import.meta.url),
      ),
    },
  },
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.{ts,tsx}'], exclude: ['src/observability/context.test.tsx'] } },
      { extends: true, test: { name: 'react', include: ['src/observability/context.test.tsx'], environment: 'happy-dom' } },
    ],
    env: {
      EXPO_PUBLIC_API_URL: 'http://localhost:8787',
    },
  },
})
