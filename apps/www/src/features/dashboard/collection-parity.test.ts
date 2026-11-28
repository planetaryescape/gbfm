import { Story, TestHost } from '@effect/ui/testing'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { runWithLayer } from '../player/testing'
import { CollectionMessage, DashboardCollectionNoDeps, RemoveSavedItem } from './collection'
import { emptyDocument } from './document'
import {
  type DashboardRequest,
  DashboardRequestError,
  DashboardService,
  ReadDashboard,
} from './service'

const principal = { id: 'listener', name: null, username: null, role: 'user' }

const requestId = '6da42445-0ad9-4df5-aeb4-4c20d2cd440c'

describe('native collection mutation parity', () => {
  it.each(['audio', 'show', 'reminder'])(
    'pins a %s removal to its observed revision and retries the identical HTTP payload',
    async (kind) => {
      const section = kind === 'reminder' ? 'reminders' : 'favorites'

      const path =
        kind === 'reminder'
          ? '/api/music-reminders/item'
          : `/api/favorites/${kind === 'show' ? 'show/' : ''}item`

      const writes: Array<DashboardRequest> = []

      const document = {
        ...emptyDocument,
        rows: [
          {
            id: 'saved',
            title: 'Fixture',
            detail: '',
            href: null,
            actionId: kind === 'show' ? 'show/item' : 'item',
            membershipRevision: 27,
            commandRevision: 3,
          },
        ],
      }

      const service = Layer.succeed(DashboardService, {
        request: (request: DashboardRequest) => {
          if (request.method !== 'DELETE') return Effect.succeed(emptyDocument)
          writes.push(request)

          return writes.length === 1
            ? Effect.fail(
                new DashboardRequestError({ status: null, message: 'Response lost after commit' }),
              )
            : Effect.succeed(emptyDocument)
        },
        readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
        writePlayerPreferences: () => Effect.void,
      })

      const layer = Layer.mergeAll(ReadDashboard.layer, RemoveSavedItem.layer).pipe(
        Layer.provide(service),
      )

      await runWithLayer(
        Layer.merge(layer, TestHost.layer()),
        Effect.gen(function* () {
          const root = yield* TestHost.mount(DashboardCollectionNoDeps, {
            principal,
            section,
            url: `/dashboard/${section}`,
            initialDocument: document,
          })

          root.send(CollectionMessage.ClickedRemove({ id: 'saved' }))
          yield* TestHost.settle
          expect(root.model()?.pending?.requestId).toMatch(/^[0-9a-f-]{36}$/)
          expect(root.model()?.busy).toBe(false)
          root.send(CollectionMessage.ClickedRemove({ id: 'saved' }))
          yield* TestHost.settle
          expect(root.model()?.pending).toBeNull()
        }),
      )
      expect(writes).toHaveLength(2)
      expect(writes[1]).toEqual(writes[0])
      expect(writes[0]?.path).toBe(path)
      expect(JSON.parse(writes[0]?.body ?? 'null')).toMatchObject({
        expectedRevision: kind === 'reminder' ? 3 : 27,
        requestId: expect.any(String),
      })
    },
  )

  it.each([409, 410])(
    'retires a definitive refusal (%s) until a fresh observation and explicit intent',
    (status) =>
      Effect.runSync(
        Effect.scoped(
          Effect.gen(function* () {
            const document = (revision: number) => ({
              ...emptyDocument,
              rows: [
                {
                  id: 'saved',
                  title: 'Fixture',
                  detail: '',
                  href: null,
                  actionId: 'item',
                  membershipRevision: revision,
                },
              ],
            })

            const s = yield* Story.make(DashboardCollectionNoDeps, {
              principal,
              section: 'favorites',
              url: '/dashboard/favorites',
              initialDocument: document(5),
            })

            const intent = {
              principalId: principal.id,
              section: 'favorites',
              rowId: 'saved',
              path: '/api/favorites/item',
              expectedRevision: 5,
              requestId,
            }

            s.send(CollectionMessage.ClickedRemove({ id: 'saved' })).resolve(
              RemoveSavedItem,
              CollectionMessage.FailedRemove({ intent, status, message: 'Refused' }),
            )
            expect(s.model.pending).toBeNull()
            expect(s.model.error).toContain(status === 409 ? 'changed' : 'expired')
            s.send(CollectionMessage.ClickedRemove({ id: 'saved' })).expectNone()
            s.send(CollectionMessage.ClickedRefresh()).loaded('document', document(6))
            const next = { ...intent, expectedRevision: 6, requestId: null }
            s.send(CollectionMessage.ClickedRemove({ id: 'saved' }))
              .expectExact(RemoveSavedItem.make({ intent: next }))
              .resolve(
                RemoveSavedItem,
                CollectionMessage.SucceededRemove({ intent: { ...next, requestId } }),
              )
              .loaded('document', emptyDocument)
            expect(s.model.pending).toBeNull()
          }),
        ),
      ),
  )

  it.each(['favorites', 'reminders'])('does not fabricate a missing %s revision', (section) =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardCollectionNoDeps, {
            principal,
            section,
            url: `/dashboard/${section}`,
            initialDocument: {
              ...emptyDocument,
              rows: [{ id: 'saved', title: 'Fixture', detail: '', href: null, actionId: 'item' }],
            },
          })

          s.send(CollectionMessage.ClickedRemove({ id: 'saved' })).expectNone()
          expect(s.model.pending).toBeNull()
          expect(s.model.error).toBe('Reload to observe the saved item before removing it.')
        }),
      ),
    ),
  )

  it('ignores duplicate requests and mismatched ownership, request IDs and repeated acknowledgements', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardCollectionNoDeps, {
            principal,
            section: 'favorites',
            url: '/dashboard/favorites',
            initialDocument: {
              ...emptyDocument,
              rows: [
                {
                  id: 'saved',
                  title: 'Fixture',
                  detail: '',
                  href: null,
                  actionId: 'item',
                  membershipRevision: 7,
                },
              ],
            },
          })

          const intent = {
            principalId: principal.id,
            section: 'favorites',
            rowId: 'saved',
            path: '/api/favorites/item',
            expectedRevision: 7,
            requestId,
          }

          s.send(CollectionMessage.ClickedRemove({ id: 'saved' })).resolve(
            RemoveSavedItem,
            CollectionMessage.FailedRemove({ intent, status: null, message: 'Lost' }),
          )
          const command = RemoveSavedItem.make({ intent })
          s.send(CollectionMessage.ClickedRemove({ id: 'saved' }))
            .expectExact(command)
            .keepPending(command)
          const pending = s.model

          for (const message of [
            CollectionMessage.ClickedRemove({ id: 'saved' }),
            CollectionMessage.SucceededRemove({
              intent: { ...intent, principalId: 'someone-else' },
            }),
            CollectionMessage.SucceededRemove({ intent: { ...intent, requestId: 'another-id' } }),
          ]) {
            s.send(message).expectExact(command).keepPending(command)
            expect(s.model).toEqual(pending)
          }

          s.resolve(command, CollectionMessage.SucceededRemove({ intent })).loaded(
            'document',
            emptyDocument,
          )
          const completed = s.model
          s.send(CollectionMessage.SucceededRemove({ intent })).expectNone()
          expect(s.model).toEqual(completed)
        }),
      ),
    ))
})
