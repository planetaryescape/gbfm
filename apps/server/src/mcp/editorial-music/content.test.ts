/* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- Expectations describe the shared recursive rich-content wire schema without variant constructors. */
import { Effect, Schema } from 'effect'
import { expect, test } from 'vitest'

import {
  EditorialPreviewResult,
  findMusicMentions,
  insertMusicEmbedSource,
  previewEditorialContent,
} from './content'

test('finds authored catalogue and normalized provider mentions without resolving or importing', async () => {
  const result = await Effect.runPromise(
    findMusicMentions({
      content:
        '::music{type="album" id="AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"}\n\n' +
        'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6?si=tracking\n\n' +
        'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6\n\nhttps://example.com/not-music',
    }),
  )

  expect(result.mentions).toEqual([
    { entityType: 'album', entityId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', url: null },
    {
      entityType: 'track',
      entityId: null,
      url: 'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6',
    },
  ])
})

test('preview renders safe shared rich content and diagnostics with no runtime persistence/provider services', async () => {
  const result = await Effect.runPromise(
    previewEditorialContent({
      content:
        '# Preview\n\nA **bold** note.\n\n::music{type="track" id="existing"}\n\n<script>unsafe()</script>',
    }),
  )

  expect(Schema.is(EditorialPreviewResult)(result)).toBe(true)
  expect(result.richContent.blocks).toContainEqual({
    _tag: 'UnavailableEmbed',
    kind: 'music',
    label: 'This music embed is unavailable.',
    href: null,
  })
  expect(result.diagnostics.map((item) => item.code)).toContain('unsupported-html')
  expect(result.richContent.blocks.at(-1)).toEqual({
    _tag: 'Unsupported',
    source: '<script>unsafe()</script>',
    reason: 'raw-html',
  })
})

test('source limits reject excess encoded bytes and excess distinct mentions instead of truncating', async () => {
  const tooMany = Array.from(
    { length: 51 },
    (_, index) => `::music{type="track" id="track-${index}"}`,
  ).join('\n\n')

  for (const content of ['é'.repeat(60_000), tooMany]) {
    await expect(Effect.runPromise(findMusicMentions({ content }))).rejects.toMatchObject({
      code: 'invalid_input',
    })
  }
})

test('embed insertion preserves whitespace and refuses a blank boundary inside a fenced code block', async () => {
  const target = { entityType: 'track', entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as const
  const before = 'A **note**.  \n\n'
  const after = 'Next paragraph.\n'
  expect(
    await Effect.runPromise(insertMusicEmbedSource(before + after, target, before.length)),
  ).toBe(before + `::music{type="track" id="${target.entityId}" tracks="false"}\n\n` + after)
  const source = '```text\nexample\n\nmore code\n```'
  await expect(
    Effect.runPromise(insertMusicEmbedSource(source, target, source.indexOf('more'))),
  ).rejects.toMatchObject({ code: 'invalid_input' })
})
