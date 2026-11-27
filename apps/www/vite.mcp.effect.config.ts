import { defineConfig, mergeConfig } from 'vite'

import native from './vite.effect.config.ts'

export default mergeConfig(
  native,
  defineConfig({
    ssr: { external: ['debug', 'extend'] },
    environments: { ssr: { keepProcessEnv: true, resolve: { builtins: ['node:async_hooks'] } } },
  }),
)
