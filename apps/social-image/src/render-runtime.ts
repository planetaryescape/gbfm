import { initWasm } from '@resvg/resvg-wasm'
import { Data } from 'effect'
import { init as initSatori } from 'satori/standalone'

export interface SocialCardRenderAssets {
  readonly loadWasm: (name: 'yoga.wasm' | 'resvg.wasm') => Promise<WebAssembly.Module | ArrayBuffer>
  readonly loadFont: (
    name: 'JetBrainsMono-Bold.ttf' | 'JetBrainsMono-ExtraBold.ttf',
  ) => Promise<ArrayBuffer>
  readonly loadImage: (url: string) => Promise<string | null>
}

type Initialization =
  | { readonly _tag: 'Uninitialized' }
  | { readonly _tag: 'Initializing'; readonly ready: Promise<void> }
  | { readonly _tag: 'Ready'; readonly ready: Promise<void> }

const Initialization = Data.taggedEnum<Initialization>()

export const createRenderRuntime = (initializers: {
  readonly yoga: (wasm: WebAssembly.Module | ArrayBuffer) => void | Promise<void>
  readonly resvg: (wasm: WebAssembly.Module | ArrayBuffer) => void | Promise<void>
}) => {
  let state: Initialization = Initialization.Uninitialized()

  return (assets: SocialCardRenderAssets): Promise<void> =>
    Initialization.$match(state, {
      Uninitialized: () => {
        const ready = Promise.all([
          assets.loadWasm('yoga.wasm').then(initializers.yoga),
          assets.loadWasm('resvg.wasm').then(initializers.resvg),
        ])
          .then(() => {
            state = Initialization.Ready({ ready })
          })
          .catch((error) => {
            state = Initialization.Uninitialized()
            throw error
          })

        state = Initialization.Initializing({ ready })

        return ready
      },
      Initializing: ({ ready }) => ready,
      Ready: ({ ready }) => ready,
    })
}

export const initializeRuntime = createRenderRuntime({ yoga: initSatori, resvg: initWasm })
