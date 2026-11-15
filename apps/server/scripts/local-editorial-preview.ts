import { readFileSync } from 'node:fs'

import { eq } from 'drizzle-orm'
import { Layer } from 'effect'

import { user } from '@/db/auth.schema'
import { replaceEntityLabels } from '@/db/labels'
import { makeDatabaseClient } from '@/db/layer'
import { musicAlbumsTable, musicEntityLinksTable, musicTracksTable } from '@/db/music-entity.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { seedLocalUsers } from '@/db/seed-local-users'
import { seedMusicLookups } from '@/db/seed-music-lookups'
import { ConfigService, createConfig } from '@/services/config.service'
import { createTestWebHandler } from '@/test/http-handler'
import { createMigratedD1Database } from '@/test/migrate-d1'

interface MusicFixture {
  readonly id: string
  readonly kind: 'album' | 'track'
  readonly title: string
  readonly artists: string
  readonly cover: string | null
}

interface LinkFixture {
  readonly entityType: 'album' | 'track'
  readonly entityId: string
  readonly platform: string
  readonly url: string
  readonly status: string
}

const required = (name: string) => {
  const value = process.env[name]

  if (!value) throw new Error(`${name} must point at a local fixture file`)

  return value
}

const readJson = <A>(name: string): A => JSON.parse(readFileSync(required(name), 'utf8'))

const port = Number(process.env.PORT ?? 3004)

const frontend = process.env.FRONTEND_URL ?? 'http://127.0.0.1:5173'

const content = readFileSync(required('PREVIEW_CONTENT'), 'utf8')

const music = [
  ...new Map(
    readJson<Array<MusicFixture>>('PREVIEW_MUSIC').map((item) => [item.id, item]),
  ).values(),
]

const links = readJson<Array<Array<LinkFixture>>>('PREVIEW_LINKS').flat()

const resource = await createMigratedD1Database()

const database = makeDatabaseClient(resource.database)

await seedLocalUsers(database)

await seedMusicLookups(database)

const slugOf = (item: MusicFixture) =>
  `${item.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}-${item.id.slice(0, 8)}`

const row = (item: MusicFixture) => ({
  id: item.id,
  title: item.title,
  slug: slugOf(item),
  artistNames: item.artists.split(', '),
  coverImageUrl: item.cover,
})

const chunks = <A>(items: ReadonlyArray<A>, size = 10) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size),
  )

const albums = music.flatMap((item) => (item.kind === 'album' ? [row(item)] : []))

const tracks = music.flatMap((item) => (item.kind === 'track' ? [row(item)] : []))

for (const batch of chunks(albums)) await database.insert(musicAlbumsTable).values(batch)

for (const batch of chunks(tracks)) await database.insert(musicTracksTable).values(batch)

for (const batch of chunks(links))
  await database.insert(musicEntityLinksTable).values(
    batch.map((link) => ({
      entityType: link.entityType,
      entityId: link.entityId,
      platform: link.platform,
      url: link.url,
      status: link.status,
    })),
  )

const [creator] = await database.select().from(user).where(eq(user.email, 'creator@gbfm.local'))

if (!creator) throw new Error('Local creator was not seeded')

const [post] = await database
  .insert(postsTable)
  .values({
    slug: process.env.PREVIEW_SLUG ?? 'local-preview',
    title: process.env.PREVIEW_TITLE ?? 'Local preview',
    description: process.env.PREVIEW_DESCRIPTION ?? null,
    thumbnailUrl: process.env.PREVIEW_ARTWORK ?? null,
    content,
    type: 'post',
    draft: false,
  })
  .returning()

if (!post) throw new Error('Preview post was not seeded')

await database.insert(postCreators).values({ postId: post.id, creatorId: creator.id })

await replaceEntityLabels(database, 'post', post.id, {
  tags: (process.env.PREVIEW_TAGS ?? '').split(',').filter(Boolean),
})

const baseConfig = createConfig()

const handler = createTestWebHandler(
  resource.database,
  undefined,
  undefined,
  undefined,
  Layer.succeed(ConfigService, {
    ...baseConfig,
    urls: { ...baseConfig.urls, frontend },
    auth: {
      ...baseConfig.auth,
      betterAuthSecret: 'local-preview-secret-at-least-32-characters',
      betterAuthUrl: `http://127.0.0.1:${port}`,
    },
  }),
)

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch: (request) => handler.handler(request),
})

process.stdout.write(
  `Local editorial preview API on ${server.url} serving /editorial/${post.slug} (${albums.length} albums, ${tracks.length} tracks, ${links.length} links)\n`,
)

const stop = async () => {
  await server.stop(true)
  await handler.dispose()
  await resource.dispose()
  process.exit()
}

process.on('SIGINT', stop)

process.on('SIGTERM', stop)
