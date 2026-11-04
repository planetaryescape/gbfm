import { describe, expect, it } from 'vitest'

import { createRenderRuntime, type SocialCardRenderAssets } from './render-runtime'

const unusedAssets = {
  loadFont: async () => new ArrayBuffer(0),
  loadImage: async () => null,
}

describe('render runtime initialization', () => {
  it('shares concurrent and completed initialization, including the first asset provider', async () => {
    const loaded: Array<string> = []
    const laterLoaded: Array<string> = []
    const initialized: Array<string> = []
    const yoga = new ArrayBuffer(1)
    const resvg = new ArrayBuffer(2)
    const initializedWasm: Array<WebAssembly.Module | ArrayBuffer> = []

    const initialize = createRenderRuntime({
      yoga: (wasm) => {
        initializedWasm.push(wasm)
        initialized.push('yoga')
      },
      resvg: (wasm) => {
        initializedWasm.push(wasm)
        initialized.push('resvg')
      },
    })

    const assets: SocialCardRenderAssets = {
      ...unusedAssets,
      loadWasm: async (name) => {
        loaded.push(name)

        return name === 'yoga.wasm' ? yoga : resvg
      },
    }

    const laterAssets: SocialCardRenderAssets = {
      ...unusedAssets,
      loadWasm: async (name) => {
        laterLoaded.push(name)

        return new ArrayBuffer(0)
      },
    }

    const first = initialize(assets)
    expect(initialize(laterAssets)).toBe(first)
    await first
    expect(initialize(laterAssets)).toBe(first)
    expect(loaded).toEqual(['yoga.wasm', 'resvg.wasm'])
    expect(laterLoaded).toEqual([])
    expect(initialized).toEqual(['yoga', 'resvg'])
    expect(initializedWasm[0]).toBe(yoga)
    expect(initializedWasm[1]).toBe(resvg)
  })

  it('retries both initializers after partial success and preserves the rejection', async () => {
    let yogaCalls = 0
    let resvgCalls = 0
    const failure = new Error('fixture initialization failure')

    const initialize = createRenderRuntime({
      yoga: () => {
        yogaCalls += 1
      },
      resvg: async () => {
        resvgCalls += 1

        if (resvgCalls === 1) throw failure
      },
    })

    const assets: SocialCardRenderAssets = {
      ...unusedAssets,
      loadWasm: async () => new ArrayBuffer(0),
    }

    const failed = initialize(assets)
    expect(initialize(assets)).toBe(failed)
    await expect(failed).rejects.toBe(failure)
    const retry = initialize(assets)
    expect(retry).not.toBe(failed)
    await retry
    expect([yogaCalls, resvgCalls]).toEqual([2, 2])
  })

  it('leaves synchronous asset-loader failures retryable', async () => {
    const initialize = createRenderRuntime({ yoga: () => undefined, resvg: () => undefined })
    expect(() =>
      initialize({
        ...unusedAssets,
        loadWasm: () => {
          throw new Error('fixture load failure')
        },
      }),
    ).toThrow('fixture load failure')
    await initialize({ ...unusedAssets, loadWasm: async () => new ArrayBuffer(0) })
  })
})
