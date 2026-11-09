import { Effect, Layer, ManagedRuntime, Predicate } from 'effect'
import type { Command } from 'foldkit'
import { Scene } from 'foldkit/test'
import { describe, expect, it } from 'vitest'

import { SpotifyConnectionLive } from '../../spotify/connection'
import { collection } from './collection'
import type { Services } from './command'
import { emptyDocument, parseDashboardDocument } from './document'
import { init, initialModel } from './init'
import { Message } from './message'
import { KeyServiceLive } from './page/api-keys'
import { SessionServiceLive } from './page/sessions'
import { endpointFor } from './section'
import { makeDashboardServiceLayer } from './service'
import { update } from './update'

const member = { id: 'user-1', role: 'user' as const }

describe('dashboard submodel', () => {
  it('uses existing account and admin endpoints', () => {
    expect(endpointFor('profile')).toBe('/api/user/profile')
    expect(endpointFor('content/mixes')).toContain('/api/content/audio/mix/manage')
    expect(endpointFor('frontend-errors')).toBe('/api/admin/telemetry')
  })

  it('encodes user searches and preserves requested pagination when the API omits its offset', async () => {
    const path = endpointFor(
      'users',
      new URLSearchParams({ search: ' dj+test@example.com ', offset: '25' }),
    )

    expect(path).toBe(
      '/auth/admin/list-users?limit=25&offset=25&searchField=email&searchValue=dj%2Btest%40example.com',
    )

    const document = await Effect.runPromise(
      parseDashboardDocument(path ?? '', { users: [], total: 27, limit: 25 }),
    )

    expect(document.fields).toEqual({ search: 'dj+test@example.com', offset: '25' })

    for (const offset of ['-1', '1.5', 'NaN', 'Infinity']) {
      expect(endpointFor('users', new URLSearchParams({ offset }))).toBe(
        '/auth/admin/list-users?limit=25&offset=0',
      )
    }
  })

  it('waits for a query before searching', () => {
    expect(endpointFor('search')).toBe(null)
    expect(endpointFor('search', new URLSearchParams({ q: '   ' }))).toBe(null)
    expect(endpointFor('search', new URLSearchParams({ q: ' deep house ' }))).toBe(
      '/api/search?q=deep+house',
    )
  })

  it('pages content lists from the requested offset', () => {
    expect(endpointFor('all/mixes', new URLSearchParams({ offset: '25' }))).toBe(
      '/api/content/audio/mix/manage?limit=25&offset=25',
    )
    expect(endpointFor('content/tweets', new URLSearchParams({ offset: '-5' }))).toBe(
      '/api/content/posts/manage?type=micro&limit=25&offset=0',
    )
  })

  it('does not issue an admin request for a non-admin principal', () => {
    const result = init('users', member)()
    expect(result.model).toMatchObject({ phase: 'error', error: 'Administrator access required.' })
    expect(result.commands).toBeUndefined()
  })

  it('turns profile saves into a real profile API command', () => {
    const model = {
      ...initialModel('profile', member),
      phase: 'ready' as const,
      fields: { email: 'listener@example.com' },
    }

    const result = update(model, Message.SaveProfile())
    expect(result.commands?.[0]).toMatchObject({
      name: 'DashboardWrite',
      args: { path: '/api/user/profile', method: 'PATCH' },
    })
  })

  it('lets an admin replace an unpublished featured mix with automatic selection', async () => {
    const document = await Effect.runPromise(
      parseDashboardDocument('/api/admin/featured-mix', {
        mixId: 'retired',
        unavailableTitle: 'Retired mix',
        mixes: [{ id: 'newest', title: 'Newest mix' }],
      }),
    )

    expect(document.fields).toEqual({
      mixId: 'retired',
      savedMixId: 'retired',
      unavailableTitle: 'Retired mix',
    })
    expect(document.rows.map(({ id }) => id)).toEqual(['newest'])

    const loaded = update(
      initialModel('featured-mix', { id: 'admin-1', role: 'admin' }),
      Message.Loaded({ document }),
    ).model

    const automatic = update(loaded, Message.FieldChanged({ name: 'mixId', value: '' })).model

    expect(automatic.fields.mixId).not.toBe(automatic.fields.savedMixId)
    expect(update(automatic, Message.SaveFeaturedMix()).commands?.[0]).toMatchObject({
      name: 'DashboardWrite',
      args: {
        path: '/api/admin/featured-mix',
        method: 'PUT',
        body: JSON.stringify({ mixId: null }),
      },
    })
  })

  it('preserves empty and loaded collection states', () => {
    const model = initialModel('reminders', member)
    expect(update(model, Message.Loaded({ document: emptyDocument })).model).toMatchObject({
      phase: 'ready',
      rows: [],
    })
    expect(
      update(
        model,
        Message.Loaded({
          document: {
            ...emptyDocument,
            rows: [{ id: 'r1', title: 'Album', detail: 'Artist', href: null, actionId: 'r1' }],
          },
        }),
      ).model.rows[0],
    ).toMatchObject({ id: 'r1', title: 'Album', detail: 'Artist' })
  })

  it.each(['audio', 'show', 'reminder'] as const)(
    'deletes a %s with its observed revision and replays the same intent after an uncertain response and refreshed rows',
    async (kind) => {
      const id = 'e6d841a8-68fd-4351-8478-7fe248a9520e'
      const section = kind === 'reminder' ? 'reminders' : 'favorites'
      const listing = kind === 'reminder' ? '/api/music-reminders' : '/api/favorites'
      const path = `${listing}/${kind === 'show' ? 'show/' : ''}${id}`
      const writes: Array<{ path: string; body: string }> = []
      let revision = kind === 'reminder' ? 3 : 27
      let cancelled = false
      const originalRevision = revision
      const content = { id, title: 'Fixture', slug: 'fixture', thumbnailUrl: null }

      const document = () =>
        parseDashboardDocument(
          listing,
          kind === 'reminder'
            ? {
                success: true,
                total: 1,
                reminders: [
                  {
                    id,
                    userId: member.id,
                    musicTitle: 'Fixture',
                    artistName: 'Artist',
                    musicUrl: 'https://example.test/music',
                    albumCoverUrl: null,
                    reminderDate: '2026-11-12T10:00:00Z',
                    notes: null,
                    status: 'pending',
                    isSent: false,
                    commandRevision: revision,
                    dispatchState: cancelled ? 'cancelled' : 'open',
                    createdAt: '2026-11-09T10:00:00Z',
                    updatedAt: '2026-11-09T10:00:00Z',
                  },
                ],
              }
            : {
                success: true,
                total: 1,
                favorites: [
                  {
                    id: 'favorite-row',
                    userId: member.id,
                    membershipRevision: revision,
                    audioId: kind === 'audio' ? id : null,
                    showId: kind === 'show' ? id : null,
                    createdAt: '2026-11-09T10:00:00Z',
                    audio:
                      kind === 'audio'
                        ? { ...content, type: 'mix', url: 'https://example.test/mix.mp3' }
                        : null,
                    show: kind === 'show' ? content : null,
                  },
                ],
              },
        )

      const fetcher: typeof fetch = async (input, options) => {
        expect(options?.method).toBe('DELETE')
        expect(new Headers(options?.headers).get('content-type')).toBe('application/json')

        if (!(input instanceof URL) || !Predicate.isString(options?.body))
          throw new Error('Expected a URL and JSON request body')
        writes.push({ path: input.href, body: options.body })

        if (writes.length === 1) throw new TypeError('Response lost after commit')

        return new Response(null, { status: 204 })
      }

      const layer = Layer.mergeAll(
        makeDashboardServiceLayer(fetcher),
        SpotifyConnectionLive,
        KeyServiceLive,
        SessionServiceLive,
      )

      const runtime = ManagedRuntime.make(layer)

      const run = (command: Command.Command<Message, never, Services> | undefined) => {
        if (!command) throw new Error('Expected dashboard command')

        return runtime.runPromise(command.effect)
      }

      try {
        const loaded = update(
          initialModel(section, member),
          Message.Loaded({
            document: await Effect.runPromise(document()),
          }),
        ).model

        const rowId = loaded.rows[0]?.id

        if (!rowId) throw new Error('Expected fixture row')
        const pending = update(loaded, Message.DeleteRequested({ id: rowId }))
        expect(
          update(pending.model, Message.DeleteRequested({ id: rowId })).commands,
        ).toBeUndefined()
        Scene.scene(
          { update, view: collection },
          Scene.given(pending.model),
          Scene.expect(Scene.role('button', { name: 'Remove Fixture' })).toBeDisabled(),
        )
        const failure = await run(pending.commands?.[0])
        expect(writes[0]?.path).toBe(`http://localhost${path}`)
        expect(JSON.parse(writes[0]?.body ?? 'null')).toEqual({
          expectedRevision: originalRevision,
          requestId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ),
        })
        const failed = update(pending.model, failure).model
        revision += 11
        cancelled = kind === 'reminder'

        const refreshed = update(
          failed,
          Message.Loaded({
            document: await Effect.runPromise(document()),
          }),
        ).model

        Scene.scene(
          { update, view: collection },
          Scene.given(refreshed),
          Scene.expect(Scene.role('button', { name: 'Retry removal of Fixture' })).toBeEnabled(),
        )
        const missingRow = update(refreshed, Message.Loaded({ document: emptyDocument })).model
        Scene.scene(
          { update, view: collection },
          Scene.given(missingRow),
          Scene.expect(Scene.role('button', { name: 'Retry pending removal' })).toBeEnabled(),
        )
        const retry = update(missingRow, Message.DeleteRequested({ id: rowId }))
        const completed = await run(retry.commands?.[0])
        expect(writes[1]).toEqual(writes[0])

        if (!Predicate.isTagged(completed, 'DeleteCompleted'))
          throw new Error('Expected acknowledged deletion')
        const otherOwner = { ...retry.model, principal: { ...member, id: 'other-owner' } }
        expect(update(otherOwner, completed).model).toBe(otherOwner)
        expect(
          update(
            retry.model,
            Message.DeleteCompleted({
              intent: { ...completed.intent, requestId: 'e85e2a1b-1b97-4d87-9614-1fec238f9207' },
            }),
          ).model,
        ).toBe(retry.model)
        const saved = update(retry.model, completed)
        expect(saved.model.deletePending).toBeNull()
        expect(update(saved.model, completed).model).toBe(saved.model)
        expect(saved.model.phase).toBe('loading')
        expect(saved.commands?.[0]?.args).toEqual({
          path: kind === 'reminder' ? '/api/music-reminders' : '/api/favorites?limit=25&offset=0',
        })
      } finally {
        await runtime.dispose()
      }
    },
  )

  it.each(['reminders', 'favorites'])(
    'does not fabricate a missing %s revision or issue a removal',
    (section) => {
      const loaded = update(
        initialModel(section, member),
        Message.Loaded({
          document: {
            ...emptyDocument,
            rows: [{ id: 'r1', title: 'Fixture', detail: '', href: null, actionId: 'r1' }],
          },
        }),
      ).model

      const result = update(loaded, Message.DeleteRequested({ id: 'r1' }))
      expect(result.commands).toBeUndefined()
      expect(result.model.phase).toBe('error')
      expect(result.model.deletePending).toBeNull()
    },
  )
})
