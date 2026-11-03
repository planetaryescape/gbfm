import type { MicroPostNeighboursResponse } from '@gbfm/api/navigation'
import type { MicroPostScreenResponse } from '@gbfm/api/post'
import { Image } from 'react-native'

const LIMIT = 60

const boundedMap = <A>() => {
  const entries = new Map<string, A>()

  return {
    get: (key: string) => entries.get(key),
    has: (key: string) => entries.has(key),
    set: (key: string, value: A) => {
      entries.delete(key)
      entries.set(key, value)

      if (entries.size <= LIMIT) return
      const oldest = entries.keys().next()

      if (!oldest.done) entries.delete(oldest.value)
    },
  }
}

const screens = boundedMap<MicroPostScreenResponse>()

const neighbours = boundedMap<MicroPostNeighboursResponse>()

const cacheKey = (identity: string, slug: string) => `${identity}:${slug}`

const artwork = (screen: MicroPostScreenResponse) =>
  [
    screen.post.music?.entity.coverImageUrl,
    screen.post.creators?.[0]?.image,
    ...screen.replies.map((reply) => reply.creators?.[0]?.image),
  ].filter((url): url is string => Boolean(url))

export const readerCache = (identity: string) => ({
  screen: (slug: string) => screens.get(cacheKey(identity, slug)),
  hasScreen: (slug: string) => screens.has(cacheKey(identity, slug)),
  storeScreen: (screen: MicroPostScreenResponse) => {
    screens.set(cacheKey(identity, screen.post.slug), screen)
  },
  warmScreen: (screen: MicroPostScreenResponse) => {
    screens.set(cacheKey(identity, screen.post.slug), screen)

    for (const url of artwork(screen)) Image.prefetch(url).catch(() => {})
  },
  neighbours: (slug: string) => neighbours.get(cacheKey(identity, slug)),
  storeNeighbours: (slug: string, value: MicroPostNeighboursResponse) => {
    neighbours.set(cacheKey(identity, slug), value)
  },
})

export type ReaderCache = ReturnType<typeof readerCache>
