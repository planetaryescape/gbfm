import type { Model } from '../model'

export const readerViewState = (
  model: Pick<Model, 'loading' | 'pendingPath' | 'flags' | 'navigationId' | 'error'>,
) => {
  const path = model.pendingPath ?? new URL(model.flags.url).pathname
  const active = path.startsWith('/tweet/')
  const base = { active, request: model.navigationId }

  if (model.loading) return { ...base, status: 'loading' }

  if (model.error || model.flags.failure || model.flags.status >= 500)
    return { ...base, status: 'error' }

  if (model.flags.tweet) return { ...base, status: 'ready' }

  return { ...base, status: 'empty' }
}
