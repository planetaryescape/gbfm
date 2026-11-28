import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { emptyDraft } from './domain'
import { CreatorDraftSchema, CreatorStorageError, reconcileStoredDraft } from './services'

const storage = () => {
  const values = new Map<string, string>()

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

const draft = { ...emptyDraft('micro', 'creator'), title: 'Draft' }

const read = (local: ReturnType<typeof storage>) =>
  Schema.decodeUnknownSync(Schema.fromJsonString(CreatorDraftSchema))(local.getItem('draft'))

describe('native creator local storage reconciliation', () => {
  it('retains newer local text with the revision returned by the completed save', async () => {
    const local = storage()
    const before = { ...draft, expectedUpdatedAt: '2026-11-07T00:00:00.000Z' }
    const retained = { ...before, content: 'Newer local text' }
    local.setItem('draft', JSON.stringify(before))
    const updatedAt = '2026-11-07T00:00:01.000Z'

    await Effect.runPromise(
      reconcileStoredDraft(
        local,
        'draft',
        before,
        { id: 'post', slug: 'saved', updatedAt },
        retained,
      ),
    )

    expect(read(local)).toMatchObject({
      content: retained.content,
      expectedUpdatedAt: updatedAt,
      editSlug: 'saved',
    })
  })

  it('removes only the saved snapshot and retains newer local edits with remote identity', async () => {
    const local = storage()
    local.setItem('draft', JSON.stringify(draft))
    await Effect.runPromise(
      reconcileStoredDraft(local, 'draft', draft, { id: 'post', slug: 'saved' }),
    )
    expect(local.getItem('draft')).toBeNull()

    local.setItem('draft', JSON.stringify({ ...draft, title: 'Newer' }))
    await Effect.runPromise(
      reconcileStoredDraft(local, 'draft', draft, { id: 'post', slug: 'saved' }),
    )
    expect(read(local)).toMatchObject({ title: 'Newer', postId: 'post', editSlug: 'saved' })
  })

  it('retains malformed local data and classifies cleanup failure without a defect', async () => {
    const local = storage()
    local.setItem('draft', 'invalid')

    const error = await Effect.runPromise(
      reconcileStoredDraft(local, 'draft', draft, { id: 'post', slug: 'saved' }).pipe(Effect.flip),
    )

    expect(error).toBeInstanceOf(CreatorStorageError)
    expect(local.getItem('draft')).toBe('invalid')
  })

  it.each(['absent', 'saved', 'intermediate'])(
    'persists newer in-memory edits after an incomplete autosave, existing=%s',
    async (existing) => {
      const local = storage()

      if (existing !== 'absent')
        local.setItem(
          'draft',
          JSON.stringify({
            ...draft,
            content: existing === 'intermediate' ? 'Older autosave' : draft.content,
          }),
        )

      await Effect.runPromise(
        reconcileStoredDraft(
          local,
          'draft',
          draft,
          { id: 'post', slug: 'saved' },
          { ...draft, content: 'Not yet locally saved' },
        ),
      )
      expect(read(local)).toMatchObject({
        content: 'Not yet locally saved',
        postId: 'post',
        editSlug: 'saved',
      })
    },
  )

  it('does not attach remote identity to a different local draft', async () => {
    const local = storage()
    const replacement = { ...draft, postId: 'other', editSlug: 'other', title: 'Other draft' }
    local.setItem('draft', JSON.stringify(replacement))

    await Effect.runPromise(
      reconcileStoredDraft(
        local,
        'draft',
        draft,
        { id: 'post', slug: 'saved' },
        { ...draft, content: 'Retained edit' },
      ),
    )
    expect(read(local)).toEqual(replacement)
  })

  it('does not overwrite a draft changed by another tab during reconciliation', async () => {
    const local = storage()
    const replacement = JSON.stringify({ ...draft, content: 'Other tab latest' })
    local.setItem('draft', JSON.stringify(draft))
    let reads = 0

    await Effect.runPromise(
      reconcileStoredDraft(
        {
          ...local,
          getItem: (key) => {
            if (++reads === 2) local.setItem(key, replacement)

            return local.getItem(key)
          },
        },
        'draft',
        draft,
        { id: 'post', slug: 'saved' },
        { ...draft, content: 'This tab retained' },
      ),
    )
    expect(local.getItem('draft')).toBe(replacement)
  })

  it.each(['read', 'decode', 'write', 'clear'])(
    'reports a neutral reconciliation operation for %s failures',
    async (stage) => {
      const local = storage()
      local.setItem('draft', stage === 'decode' ? 'invalid' : JSON.stringify(draft))

      const fail = () => {
        throw new Error('Storage unavailable')
      }

      const adapter = {
        getItem: stage === 'read' ? fail : local.getItem,
        setItem: stage === 'write' ? fail : local.setItem,
        removeItem: stage === 'clear' ? fail : local.removeItem,
      }

      const error = await Effect.runPromise(
        reconcileStoredDraft(
          adapter,
          'draft',
          draft,
          { id: 'post', slug: 'saved' },
          stage === 'write' ? { ...draft, content: 'Retained' } : null,
        ).pipe(Effect.flip),
      )

      expect(error.operation).toBe('reconcile')
    },
  )
})
