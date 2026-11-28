import { fileURLToPath, URL } from 'node:url'

import { Predicate } from 'effect'
import { createServer } from 'vite'
import { expect, test } from 'vitest'

test('the shared HTTP dispatcher and page preparation load without a Foldkit runtime', async () => {
  const server = await createServer({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    configFile: fileURLToPath(new URL('../../vite.effect.config.ts', import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null },
    logLevel: 'error',
  })

  try {
    const dispatch = await server.ssrLoadModule('/src/server/http-dispatch.ts')
    const preparation = await server.ssrLoadModule('/src/server/prepare-page-response.ts')
    expect(Predicate.isFunction(dispatch.dispatchHttp)).toBe(true)
    expect(Predicate.isFunction(preparation.preparePageResponse)).toBe(true)
    const environment = server.environments.ssr

    if (!environment) throw new Error('Missing native SSR module environment')
    const modules = [...environment.moduleGraph.idToModuleMap.keys()]
    expect(modules.length).toBeGreaterThan(0)
    expect(modules.filter((id) => /(?:^|\/)foldkit(?:\/|@|$)|@foldkit/.test(id))).toEqual([])
  } finally {
    await server.close()
  }
}, 15_000)
