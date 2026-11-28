import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

export const registerCreatorWasmFixture = () =>
  registerHooks({
    load: (url, context, nextLoad) => {
      if (!url.endsWith('/harfbuzzjs/hb.wasm')) return nextLoad(url, context)
      const bytes = readFileSync(new URL(url)).toString('base64')

      return {
        format: 'module',
        shortCircuit: true,
        source: `export default new WebAssembly.Module(Buffer.from(${JSON.stringify(bytes)}, 'base64'));`,
      }
    },
  })
