import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'

import type { SelectMdxCompiledPost } from '@/db/post.schema'
import { DatabaseError, ValidationError } from '@/errors'

import {
  deriveReplyThreadFields,
  generatePostSlug,
  normalizePostData,
  toEditorialPost,
  toMicroPost,
  validatePostData,
} from './post.service'
import { stripSlugSuffix } from './to-slug'

const basePost: SelectMdxCompiledPost = {
  id: '00000000-0000-0000-0000-000000000000',
  title: 'Title',
  description: null,
  thumbnailUrl: null,
  bannerImageUrl: null,
  slug: 'title',
  content: 'Body',
  draft: false,
  tags: [],
  type: 'post',
  musicEntityType: null,
  musicEntityId: null,
  lastOperationId: null,
  musicReferencesManaged: false,
  parentPostId: null,
  rootPostId: null,
  depth: 0,
  quotedPostId: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  compiledContent: '',
  richContent: { version: 1, blocks: [] },
  creators: [],
}

describe('validatePostData', () => {
  test('allows a tweet with only a title', async () => {
    await expect(
      Effect.runPromise(validatePostData({ type: 'micro', title: 'Track is wild' })),
    ).resolves.toBeUndefined()
  })

  test('allows a tweet with only content', async () => {
    await expect(
      Effect.runPromise(validatePostData({ type: 'micro', content: 'Track is wild' })),
    ).resolves.toBeUndefined()
  })

  test('allows a post with surrounding whitespace', async () => {
    await expect(
      Effect.runPromise(validatePostData({ type: 'post', title: ' Title ', content: ' Body ' })),
    ).resolves.toBeUndefined()
  })

  test('rejects a tweet without title or content', async () => {
    await expect(
      Effect.runPromise(validatePostData({ type: 'micro', title: ' ', content: null })),
    ).rejects.toEqual(new ValidationError({ message: 'Tweet title or body is required' }))
  })

  test('rejects a regular post without a title', async () => {
    await expect(
      Effect.runPromise(validatePostData({ type: 'post', content: 'Body' })),
    ).rejects.toEqual(new ValidationError({ message: 'Post title is required' }))
  })

  test('rejects a regular post without content', async () => {
    await expect(
      Effect.runPromise(validatePostData({ type: 'post', title: 'Title' })),
    ).rejects.toEqual(new ValidationError({ message: 'Post content is required' }))
  })
})

describe('normalizePostData', () => {
  test('normalizes empty tweet title and content to null', async () => {
    expect(normalizePostData({ title: ' ', content: '' }, 'micro')).toEqual({
      title: null,
      content: null,
    })
  })

  test('preserves non-empty tweet title and content', async () => {
    expect(normalizePostData({ title: ' Title ', content: ' Body ' }, 'micro')).toEqual({
      title: ' Title ',
      content: ' Body ',
    })
  })

  test('does not normalize regular post data', async () => {
    expect(normalizePostData({ title: ' ', content: '' }, 'post')).toEqual({
      title: ' ',
      content: '',
    })
  })

  test('does not add absent fields while normalizing tweets', async () => {
    expect(normalizePostData({ title: ' ' }, 'micro')).toEqual({ title: null })
  })
})

describe('deriveReplyThreadFields', () => {
  test('derives root and depth from a top-level parent', () => {
    const parent = { id: 'parent-id', rootPostId: null, depth: 0 }

    expect(deriveReplyThreadFields(parent)).toEqual({
      parentPostId: 'parent-id',
      rootPostId: 'parent-id',
      depth: 1,
    })
  })

  test('inherits the root and increments depth when replying to a reply', () => {
    const parent = { id: 'reply-id', rootPostId: 'root-id', depth: 2 }

    expect(deriveReplyThreadFields(parent)).toEqual({
      parentPostId: 'reply-id',
      rootPostId: 'root-id',
      depth: 3,
    })
  })
})

describe('generatePostSlug', () => {
  test('derives the slug from the title when present', () => {
    expect(stripSlugSuffix(generatePostSlug('Four Tet just dropped', null))).toBe(
      'four-tet-just-dropped',
    )
  })

  test('falls back to content when there is no title', () => {
    expect(stripSlugSuffix(generatePostSlug(null, 'a body with no title'))).toBe(
      'a-body-with-no-title',
    )
  })

  test('falls back to a generic slug when title and content are both empty', () => {
    expect(stripSlugSuffix(generatePostSlug(null, null))).toBe('post')
  })
})

describe('post type refinement', () => {
  test('refines complete editorial posts to non-null title and content', async () => {
    await expect(Effect.runPromise(toEditorialPost(basePost))).resolves.toEqual(basePost)
  })

  test('rejects editorial posts without title or content', async () => {
    await expect(
      Effect.runPromise(toEditorialPost({ ...basePost, title: null, content: 'Body' })),
    ).rejects.toEqual(
      new DatabaseError({
        message: 'Expected editorial post with title and content: title',
        operation: 'post_type_refinement',
        table: 'posts',
      }),
    )
  })

  test('refines micro posts separately from editorial posts', async () => {
    const microPost = { ...basePost, type: 'micro' as const, title: null }

    await expect(Effect.runPromise(toMicroPost(microPost))).resolves.toEqual(microPost)
  })
})
