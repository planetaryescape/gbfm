import { Option, Schema } from 'effect'

export const Checkpoint = Schema.String.check(
  Schema.isPattern(/^(?!.*[\s/?#\\])\P{C}+$/u),
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
)

export const parseCheckpoint = (value: string | null | undefined) => {
  const slug = Option.getOrNull(Schema.decodeUnknownOption(Checkpoint)(value))

  return slug && !['latest', 'new', '.', '..'].includes(slug) ? slug : null
}

export const checkpointKey = (identity: string) =>
  `gbfm:tweet-checkpoint:${encodeURIComponent(identity)}`

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
