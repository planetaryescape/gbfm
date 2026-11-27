import { checkpointKey, parseCheckpoint } from './location'

export { Checkpoint, checkpointKey, parseCheckpoint } from './location'

type PositionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const readPosition = (
  identity: string,
  storage: () => PositionStorage = () => globalThis.localStorage,
) => {
  try {
    return parseCheckpoint(storage().getItem(checkpointKey(identity)))
  } catch {
    return null
  }
}

export const savePosition = (
  identity: string,
  slug: string | null,
  storage: () => PositionStorage = () => globalThis.localStorage,
) => {
  if (slug !== null && !parseCheckpoint(slug)) return

  try {
    if (slug) storage().setItem(checkpointKey(identity), slug)
    else storage().removeItem(checkpointKey(identity))
  } catch {}
}
