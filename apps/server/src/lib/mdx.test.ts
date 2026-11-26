/* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- Assertions compare decoded tagged-union output. */
import { Effect, Predicate } from 'effect'
import { describe, expect, test, vi } from 'vitest'

import { withTestLayer } from '@/test/effect'

import { MdxService, makeMdxServiceTest, renderRichContent, validateCanonicalContent } from './mdx'

const withService = <A, E>(
  compileFn: (content: string) => Promise<string>,
  run: (svc: MdxService) => Effect.Effect<A, E>,
): Promise<A> =>
  Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        const svc = yield* MdxService

        return yield* run(svc)
      }),
      makeMdxServiceTest(compileFn),
    ),
  )

describe('MdxService', () => {
  test('renders colon-separated music terminology without consuming it as directives', async () => {
    const source = 'Re:fikks and re:prises operate as curatorial interventions.'

    const rendered = await withService(
      () => Promise.resolve(''),
      (svc) => svc.render(source),
    )

    const paragraph = rendered.blocks[0]
    expect(paragraph?._tag).toBe('Paragraph')

    if (paragraph?._tag !== 'Paragraph') throw new Error('Expected paragraph')
    expect(
      paragraph.children
        .flatMap((inline) => (Predicate.isTagged(inline, 'Text') ? [inline.value] : []))
        .join(''),
    ).toBe(source)
  })

  test('renders canonical media without executable output', () => {
    expect(renderRichContent('https://www.youtube.com/watch?v=abc').blocks[0]).toMatchObject({
      _tag: 'ExternalMediaEmbed',
      provider: 'youtube',
      embedUrl: 'https://www.youtube-nocookie.com/embed/abc',
    })
  })

  test.each([
    [
      'YouTube privacy-enhanced',
      'https://www.youtube-nocookie.com/embed/N98XIKgjRlM',
      { provider: 'youtube', embedUrl: 'https://www.youtube-nocookie.com/embed/N98XIKgjRlM' },
    ],
    [
      'Bandcamp',
      'https://bandcamp.com/EmbeddedPlayer/album=1658777641/size=large/',
      {
        provider: 'bandcamp',
        embedUrl: 'https://bandcamp.com/EmbeddedPlayer/album=1658777641/size=large/',
      },
    ],
  ])(
    'renders migrated %s iframe sources through the media allowlist',
    (_name, source, expected) => {
      expect(renderRichContent(source).blocks[0]).toMatchObject({
        _tag: 'ExternalMediaEmbed',
        ...expected,
      })
    },
  )

  test('rejects legacy JSX on canonical writes', async () => {
    await expect(
      Effect.runPromise(
        validateCanonicalContent('<Track url="https://open.spotify.com/track/abc" />'),
      ),
    ).rejects.toMatchObject({ _tag: 'ValidationError' })
  })

  test('fails with MDXCompileError when compile function throws', async () => {
    const err = new Error('syntax error at line 3')
    await expect(
      withService(
        () => Promise.reject(err),
        (svc) => svc.compile('bad mdx'),
      ),
    ).rejects.toMatchObject({ details: 'syntax error at line 3' })
  })

  describe('caching', () => {
    test('deduplicates concurrent requests for the same content', async () => {
      let calls = 0

      const fn = () =>
        new Promise<string>((resolve) => {
          calls++
          setImmediate(() => resolve('concurrent-result'))
        })

      const result = await withService(fn, (svc) =>
        Effect.gen(function* () {
          const [r1, r2] = yield* Effect.all([svc.compile('# Same'), svc.compile('# Same')], {
            concurrency: 'unbounded',
          })

          return [r1, r2]
        }),
      )

      expect(calls).toBe(1)
      expect(result).toEqual(['concurrent-result', 'concurrent-result'])
    })

    test('does not cache failures — retries on next call', async () => {
      let attempt = 0

      const fn = () => {
        attempt++

        if (attempt === 1) return Promise.reject(new Error('transient'))

        return Promise.resolve('recovered')
      }

      const result = await withService(fn, (svc) =>
        Effect.gen(function* () {
          yield* svc.compile('content').pipe(Effect.ignore)

          return yield* svc.compile('content')
        }),
      )

      expect(attempt).toBe(2)
      expect(result).toBe('recovered')
    })
  })

  describe('invalidateAll', () => {
    test('forces recompilation after cache is cleared', async () => {
      const fn = vi.fn().mockResolvedValue('fresh')
      await withService(fn, (svc) =>
        Effect.gen(function* () {
          yield* svc.compile('# Hello')
          yield* svc.invalidateAll
          yield* svc.compile('# Hello')
        }),
      )
      expect(fn).toHaveBeenCalledTimes(2)
    })
  })
})

describe('rich content layout', () => {
  test('keeps a spotlight layout through embed resolution', async () => {
    const document = renderRichContent(
      '::layout{name="spotlight"}\n\n## London\n\nhttps://www.youtube.com/watch?v=1g826StJhLk',
    )

    expect(document.layout).toBe('spotlight')
    expect(document.blocks.map((block) => block._tag)).toEqual(['Heading', 'ExternalMediaEmbed'])
    expect(renderRichContent('## London')).not.toHaveProperty('layout')
    await expect(
      Effect.runPromise(validateCanonicalContent('::layout{name="spotlight"}')),
    ).resolves.toBeUndefined()
  })
})
