import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

import { effectUi } from '../plugins/effect-ui.ts'

export default defineConfig({
  plugins: [
    effectUi({
      serverEntry: '/test/effect-ui/entry.server.ts',
      clientEntry: '/test/effect-ui/entry.client.ts',
      clientOutDir: 'dist-effect-fixture/client',
      serverOutDir: 'dist-effect-fixture/server',
    }),
    tailwindcss(),
  ],
  ssr: { target: 'webworker', noExternal: true, external: ['cloudflare:workers'] },
  build: { rolldownOptions: { external: ['cloudflare:workers'] } },
})
