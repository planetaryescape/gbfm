import type { State } from '@effect/ui/Renderer'

declare module '@effect/ui/Query' {
  export function internals(cache: {
    readonly '~@effect/ui/Query/Cache': '~@effect/ui/Query/Cache'
  }): {
    readonly hydrate: (state: State['~query']) => void
    readonly closeWindow: () => void
  }
}
