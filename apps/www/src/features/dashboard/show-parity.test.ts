import { Locator, Scene, Story, TestHost } from '@effect/ui/testing'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { runWithLayer } from '../player/testing'
import { emptyDocument } from './document'
import { DashboardLibraryNoDeps, LibraryMessage, WriteLibrary } from './library'
import {
  type DashboardRequest,
  DashboardService,
  ReadDashboard,
  DashboardRequestError,
} from './service'

const principal = { id: 'admin', name: null, username: null, role: 'admin' }

const document = {
  ...emptyDocument,
  shows: {
    data: [
      {
        id: 'show',
        title: 'Show',
        slug: 'original-slug',
        description: null,
        content: '',
        thumbnailUrl: null,
        bannerImageUrl: null,
        tags: [],
        draft: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        hosts: [],
      },
    ],
    pagination: { total: 1, limit: 25, offset: 0, hasMore: false },
  },
}

describe('native show editor parity', () => {
  it('releases a failed GET refresh lock without losing the edit or delete confirmation', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardLibraryNoDeps, {
            principal,
            section: 'shows',
            initialDocument: document,
          })

          s.send(LibraryMessage.ClickedEdit({ id: 'original-slug' })).expectNone()
          s.send(LibraryMessage.ClickedDelete()).expectNone()
          const fields = s.model.fields
          s.send(LibraryMessage.ClickedRefresh({ offset: 25 }))
          expect(s.model.busy).toBe(true)
          s.loadFailed(
            'document',
            new DashboardRequestError({ status: 503, message: 'Unavailable' }),
          )
          expect(s.model.busy).toBe(false)
          expect(s.model.operation).toBeNull()
          expect(s.model.fields).toEqual(fields)
          expect(s.model.selected).toBe('original-slug')
          expect(s.model.confirming).toBe(true)
          s.send(LibraryMessage.ToggledDraft()).expectNone()
          expect(s.model.draft).toBe(false)
        }),
      ),
    ))

  it.each(['save', 'delete', 'load'] satisfies ReadonlyArray<'save' | 'delete' | 'load'>)(
    'preserves the complete legacy ignored-message matrix while %s and its reload are pending',
    (operation) =>
      Effect.runSync(
        Effect.scoped(
          Effect.gen(function* () {
            const s = yield* Story.make(DashboardLibraryNoDeps, {
              principal,
              section: 'shows',
              initialDocument: document,
            })

            s.send(LibraryMessage.ClickedEdit({ id: 'original-slug' })).expectNone()
            s.send(LibraryMessage.ClickedDelete()).expectNone()
            const fields = s.model.fields

            const command = WriteLibrary.make({
              section: 'shows',
              action: operation === 'load' ? 'save' : operation,
              selected: 'original-slug',
              fields,
              draft: true,
              trackId: '',
              trackIds: [],
            })

            const blocked = [
              LibraryMessage.ClickedNew(),
              LibraryMessage.ClickedEdit({ id: 'original-slug' }),
              LibraryMessage.ClickedBack(),
              LibraryMessage.ClickedCancelDelete(),
              LibraryMessage.ClickedAction({ action: 'save', trackId: '' }),
              LibraryMessage.ClickedAction({ action: 'delete', trackId: '' }),
              LibraryMessage.ClickedRefresh({ offset: 0 }),
              LibraryMessage.ToggledDraft(),
              LibraryMessage.UpdatedField({ name: 'title', value: 'Ignored' }),
              LibraryMessage.ClickedDelete(),
            ]

            const expectIgnored = (reading: boolean) => {
              const submitted = s.model

              for (const message of blocked) {
                s.send(message)

                if (reading) s.expectNone()
                else s.expectExact(command).keepPending(command)
                expect(s.model).toEqual(submitted)
              }
            }

            if (operation === 'load') {
              s.send(LibraryMessage.ClickedRefresh({ offset: 25 }))
                .expectNone()
                .keepPending('document')
            } else {
              s.send(LibraryMessage.ClickedAction({ action: operation, trackId: '' }))
                .expectExact(command)
                .keepPending(command)
            }

            expect(s.model.busy).toBe(true)
            expectIgnored(operation === 'load')

            if (operation !== 'load') {
              s.resolve(
                command,
                LibraryMessage.SucceededWrite({
                  action: operation,
                  selected: null,
                  notice: operation === 'delete' ? 'Show deleted.' : 'Show saved.',
                }),
              ).keepPending('document')
              expect(s.model.busy).toBe(true)
              expectIgnored(true)
            }

            s.loaded('document', document)
            expect(s.model.busy).toBe(false)
            expect(s.model.editor).toBe(operation === 'load')
            expect(s.model.selected).toBe(operation === 'load' ? 'original-slug' : null)

            if (operation === 'load') {
              expect(s.model.fields).toEqual(fields)
              expect(s.model.confirming).toBe(true)
            }
          }),
        ),
      ),
  )

  it.each(['save', 'delete', 'refresh'])(
    'executes %s through the existing show API and reloads after writes',
    async (action) => {
      const requests: Array<DashboardRequest> = []

      const service = Layer.succeed(DashboardService, {
        request: (request: DashboardRequest) =>
          Effect.sync(() => {
            requests.push(request)

            return document
          }),
        readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
        writePlayerPreferences: () => Effect.void,
      })

      const layer = Layer.mergeAll(WriteLibrary.layer, ReadDashboard.layer).pipe(
        Layer.provide(service),
      )

      await runWithLayer(
        Layer.merge(layer, TestHost.layer()),
        Effect.gen(function* () {
          const root = yield* TestHost.mount(DashboardLibraryNoDeps, {
            principal,
            section: 'shows',
            initialDocument: document,
          })

          root.send(LibraryMessage.ClickedEdit({ id: 'original-slug' }))

          if (action === 'refresh') root.send(LibraryMessage.ClickedRefresh({ offset: 25 }))
          else if (action === 'delete') {
            root.send(LibraryMessage.ClickedDelete())
            root.send(LibraryMessage.ClickedAction({ action: 'delete', trackId: '' }))
          } else {
            root.send(LibraryMessage.UpdatedField({ name: 'slug', value: 'renamed-slug' }))
            root.send(LibraryMessage.ClickedAction({ action: 'save', trackId: '' }))
          }

          yield* TestHost.settle

          if (action === 'refresh') {
            expect(requests).toEqual([{ path: '/api/shows/manage?limit=25&offset=25' }])
            expect(root.model()?.selected).toBe('original-slug')
          } else {
            expect(requests[0]).toMatchObject({
              path: '/api/shows/original-slug',
              method: action === 'save' ? 'PATCH' : 'DELETE',
            })

            if (action === 'save')
              expect(JSON.parse(requests[0]?.body ?? 'null')).toMatchObject({
                slug: 'renamed-slug',
                draft: true,
              })
            expect(requests[1]).toEqual({ path: '/api/shows/manage?limit=25&offset=0' })
            expect(root.model()?.editor).toBe(false)
          }
        }),
      )
    },
  )

  it.each([
    { selected: null, operation: null, label: 'Create show' },
    { selected: 'original-slug', operation: null, label: 'Save changes' },
    { selected: null, operation: 'save', label: 'Saving' },
    { selected: 'original-slug', operation: 'delete', label: 'Save changes' },
  ] satisfies ReadonlyArray<{
    selected: string | null
    operation: 'save' | 'delete' | null
    label: string
  }>)('labels the $operation operation as $label', ({ selected, operation, label }) =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const props = { principal, section: 'shows', initialDocument: document }
          const state = yield* Story.make(DashboardLibraryNoDeps, props)
          const s = yield* Scene.make(DashboardLibraryNoDeps, props)
          s.given({ ...state.model, editor: true, selected, operation, busy: operation !== null })
          expect(s.current.query(Locator.text(label, { exact: true }))).toBeDefined()
        }),
      ),
    ),
  )

  it('requires an existing selection and explicit, cancellable deletion confirmation', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardLibraryNoDeps, {
            principal,
            section: 'shows',
            initialDocument: document,
          })

          s.send(LibraryMessage.ClickedAction({ action: 'delete', trackId: '' })).expectNone()
          s.send(LibraryMessage.ClickedEdit({ id: 'missing' })).expectNone()
          expect(s.model.selected).toBeNull()
          s.send(LibraryMessage.ClickedEdit({ id: 'original-slug' })).expectNone()
          s.send(LibraryMessage.ClickedDelete()).expectNone()
          const selected = s.model.selected
          s.send(LibraryMessage.ClickedCancelDelete()).expectNone()
          expect(s.model.selected).toBe(selected)
          s.send(LibraryMessage.ClickedAction({ action: 'delete', trackId: '' })).expectNone()
          expect(s.model.confirming).toBe(false)
        }),
      ),
    ))

  it('pins the original slug when saving a rename, locks the submitted edit and preserves failure retry input', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardLibraryNoDeps, {
            principal,
            section: 'shows',
            initialDocument: document,
          })

          s.send(LibraryMessage.ClickedEdit({ id: 'original-slug' })).expectNone()
          s.send(LibraryMessage.UpdatedField({ name: 'title', value: 'A new title' })).expectNone()
          s.send(LibraryMessage.UpdatedField({ name: 'slug', value: 'renamed-slug' })).expectNone()
          s.send(LibraryMessage.ToggledDraft()).expectNone()
          s.send(LibraryMessage.ClickedAction({ action: 'save', trackId: '' }))
          const submitted = s.model

          const command = WriteLibrary.make({
            section: 'shows',
            action: 'save',
            selected: 'original-slug',
            fields: submitted.fields,
            draft: false,
            trackId: '',
            trackIds: [],
          })

          s.expectExact(command).keepPending(command)

          for (const message of [
            LibraryMessage.ClickedBack(),
            LibraryMessage.ClickedNew(),
            LibraryMessage.ClickedCancelDelete(),
            LibraryMessage.ToggledDraft(),
            LibraryMessage.ClickedRefresh({ offset: 25 }),
            LibraryMessage.UpdatedField({ name: 'title', value: 'Ignored' }),
            LibraryMessage.ClickedAction({ action: 'save', trackId: '' }),
          ]) {
            s.send(message).expectExact(command).keepPending(command)
            expect(s.model).toEqual(submitted)
          }

          s.resolve(command, LibraryMessage.FailedWrite({ message: 'Unavailable' }))
          expect(s.model.fields).toEqual(submitted.fields)
          expect(s.model.selected).toBe('original-slug')
          s.send(LibraryMessage.ClickedAction({ action: 'save', trackId: '' }))
            .expectExact(command)
            .resolve(
              command,
              LibraryMessage.SucceededWrite({
                action: 'save',
                selected: null,
                notice: 'Show saved.',
              }),
            )
            .loaded('document', document)
          expect(s.model.editor).toBe(false)
          expect(s.model.fields.title).toBe('')
        }),
      ),
    ))

  it('opens an empty new show form on demand and returns to the list', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardLibraryNoDeps, {
            principal,
            section: 'shows',
            initialDocument: document,
          })

          expect(s.model.editor).toBe(false)
          s.send(LibraryMessage.ClickedNew()).expectNone()
          s.send(LibraryMessage.UpdatedField({ name: 'title', value: 'Stale' })).expectNone()
          s.send(LibraryMessage.ClickedBack()).expectNone()
          s.send(LibraryMessage.ClickedNew()).expectNone()
          expect(s.model.editor).toBe(true)
          expect(s.model.fields.title).toBe('')
          expect(s.model.selected).toBeNull()
        }),
      ),
    ))
})
