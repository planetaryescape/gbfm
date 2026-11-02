import { initWasm } from '@resvg/resvg-wasm'
import { init as initSatori } from 'satori/standalone'

export interface SocialCardRenderAssets {
  readonly loadWasm: (name: 'yoga.wasm' | 'resvg.wasm') => Promise<WebAssembly.Module | ArrayBuffer>
  readonly loadFont: (
    name: 'JetBrainsMono-Bold.ttf' | 'JetBrainsMono-ExtraBold.ttf',
  ) => Promise<ArrayBuffer>
  readonly loadImage: (url: string) => Promise<string | null>
}

let runtimeReady: Promise<void> | undefined

export const initializeRuntime = (assets: SocialCardRenderAssets) => {
  if (!runtimeReady) {
    runtimeReady = Promise.all([
      assets.loadWasm('yoga.wasm').then(initSatori),
      assets.loadWasm('resvg.wasm').then(initWasm),
    ])
      .then(() => undefined)
      .catch((error) => {
        runtimeReady = undefined
        throw error
      })
  }

  return runtimeReady
}
