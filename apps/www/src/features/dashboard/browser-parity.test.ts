import { Locator, Scene, TestHost } from '@effect/ui/testing'
import { Effect, Layer, Predicate, Schema } from 'effect'
import { expect, it } from 'vitest'

import { KeyService } from '../../page/dashboard/page/api-keys/service'
import { runWithLayer } from '../player/testing'
import { DashboardAdminPanelNoDeps, PanelMessage, ReadPanelClock } from './admin-panels'
import { DashboardAnnouncementsNoDeps } from './announcements'
import { apiKeyOperationsLayer, ApiKeysMessage, DashboardApiKeysNoDeps } from './api-keys'
import { DashboardDocument, emptyDocument } from './document'
import { DashboardLibraryNoDeps } from './library'
import { DashboardRequestError } from './service'
import { DashboardSessionsNoDeps } from './sessions'

const principal = { id: 'fixture-admin', name: null, username: null, role: 'admin' }

const panel = (section: string) => ({
  principal,
  section,
  url: `/dashboard/${section}`,
  initialDocument: emptyDocument,
})

it('declares API-key form submission to the native host without serializing credentials', async () => {
  const service = Layer.succeed(
    KeyService,
    KeyService.of({
      list: () =>
        Effect.succeed({
          data: [],
          pagination: { total: 0, limit: 20, offset: 0, hasMore: false },
        }),
      confirmPassword: () => Effect.void,
      issue: () => Effect.die('Issuance is not part of a view test'),
      revoke: () => Effect.void,
    }),
  )

  await runWithLayer(
    Layer.merge(apiKeyOperationsLayer.pipe(Layer.provideMerge(service)), TestHost.layer()),
    Effect.gen(function* () {
      const root = yield* TestHost.mount(DashboardApiKeysNoDeps, { principal })
      const form = root.get(Locator.attr('data-key-create-form', ''))
      expect(form?.tag).toBe('form')

      if (!Predicate.isTagged(form, 'Element')) throw new Error('Key form missing')
      expect(form.handlers.submit).toBeDefined()
      expect(form.eventOptions.submit?.preventDefault).toBe('always')
      root.send(ApiKeysMessage.RequestedPassword())
      yield* TestHost.settle
      const password = root.get(Locator.attr('data-key-password-form', ''))

      if (!Predicate.isTagged(password, 'Element')) throw new Error('Password form missing')
      expect(password.handlers.submit).toBeDefined()
      expect(password.eventOptions.submit?.preventDefault).toBe('always')
      expect(password.eventOptions.keydown?.preventDefault).toBeUndefined()
      expect(Object.keys(root.model() ?? {})).not.toContain('password')
      expect(Object.keys(root.model() ?? {})).not.toContain('secret')
    }),
  )
})

it('preserves the Shows editor form and accessible field names', () =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Scene.make(DashboardLibraryNoDeps, panel('shows'))
        s.click('New show')
        expect(s.current.query(Locator.tag('form'))).toBeDefined()

        for (const label of ['Title', 'Slug', 'Content', 'Tags (comma separated)'])
          expect(s.current.query(Locator.text(label, { exact: true }))).toBeDefined()
      }),
    ),
  ))

it('preserves playlist tables and the named create controls', () =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Scene.make(DashboardLibraryNoDeps, panel('playlists'))
        expect(s.current.query(Locator.attr('aria-label', 'Playlists'))?.tag).toBe('table')
        s.click('New playlist')
        expect(s.current.query(Locator.text('Playlist title', { exact: true }))).toBeDefined()
        expect(s.current.query(Locator.text('Playlist slug', { exact: true }))).toBeDefined()
      }),
    ),
  ))

it('preserves the session lookup names', () =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Scene.make(DashboardSessionsNoDeps, {})
        expect(s.current.query(Locator.text('Search user by email', { exact: true }))).toBeDefined()
        expect(s.current.query(Locator.text('Search users', { exact: true }))).toBeDefined()
      }),
    ),
  ))

it('preserves the newsletter table and subscription-status buttons', () =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Scene.make(DashboardAdminPanelNoDeps, panel('newsletter'))
        expect(s.current.query(Locator.text('Search subscribers', { exact: true }))).toBeDefined()
        expect(s.current.query(Locator.attr('aria-label', 'Newsletter subscribers'))?.tag).toBe(
          'table',
        )
        expect(s.current.query(Locator.attr('role', 'group'))).toBeDefined()
      }),
    ),
  ))

it('preserves delivery-history table, filter and pagination semantics', () =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Scene.make(DashboardAdminPanelNoDeps, panel('email-logs'))
        s.resolve(ReadPanelClock, PanelMessage.CompletedReadPanelClock({ now: Date.now() }))
        expect(s.current.query(Locator.attr('aria-label', 'Delivery history'))?.tag).toBe('table')
        expect(s.current.query(Locator.attr('aria-label', 'Recipient email'))).toBeDefined()
        expect(s.current.query(Locator.attr('aria-label', 'Delivery status'))).toBeDefined()
      }),
    ),
  ))

it('preserves announcement controls and selected-address labels', () =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Scene.make(DashboardAnnouncementsNoDeps, panel('emails'))
        expect(s.current.query(Locator.attr('aria-label', 'Published mix'))).toBeDefined()
        expect(s.current.query(Locator.text('Review announcement', { exact: true }))).toBeDefined()
      }),
    ),
  ))

it('preserves account-action success copy in the native no-JS form response', () =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Scene.make(DashboardAdminPanelNoDeps, {
          ...panel('users'),
          url: '/dashboard/users?notice=created',
        })

        expect(
          s.current.query(Locator.text('Account action completed.', { exact: true })),
        ).toBeDefined()
      }),
    ),
  ))

it('preserves the user table, role selector, More actions and ban reason', () =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Scene.make(DashboardAdminPanelNoDeps, {
          ...panel('users'),
          initialDocument: {
            ...emptyDocument,
            users: {
              total: 1,
              limit: 25,
              users: [
                {
                  id: 'one',
                  name: 'Fixture',
                  email: 'fixture@example.test',
                  role: 'creator',
                  banned: true,
                  banReason: 'Fixture restriction',
                },
              ],
            },
          },
        })

        expect(s.current.query(Locator.attr('aria-label', 'User accounts'))?.tag).toBe('table')
        expect(
          s.current.query(
            Locator.inside(
              Locator.attr('aria-label', 'User accounts'),
              Locator.attr('aria-label', 'Role'),
            ),
          )?.tag,
        ).toBe('select')
        expect(s.current.query(Locator.text('More', { exact: true }))?.tag).toBe('summary')
        expect(s.current.query(Locator.attr('title', 'Fixture restriction'))).toBeDefined()

        for (const action of ['set-role', 'invite', 'unban-user', 'remove-user'])
          expect(
            s.current.query(Locator.attr('action', `/actions/admin/${action}?search=&offset=0`)),
          ).toBeDefined()
      }),
    ),
  ))

it('preserves telemetry labels, empty sections and explicit failure/retry instead of stale data', () =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const telemetry = {
          generatedAt: '2026-09-27T10:00:00.000Z',
          windowHours: 24,
          state: 'partial',
          retentionNotice: 'Sampled aggregates only.',
          sections: {
            webVitals: {
              available: true,
              rows: [
                {
                  name: 'CLS',
                  route: '/shows/:slug',
                  release: 'fixture',
                  browser: 'chrome',
                  samples: 5,
                  p75: 0.1234,
                },
                {
                  name: 'LCP',
                  route: '/shows/:slug',
                  release: 'fixture',
                  browser: 'chrome',
                  samples: 7,
                  p75: 2345.6,
                },
              ],
            },
            navigation: { available: true, rows: [] },
            errors: { available: false, rows: [] },
            player: { available: true, rows: [] },
          },
        }

        const document = yield* Schema.decodeUnknownEffect(DashboardDocument)({
          ...emptyDocument,
          telemetry,
        })

        const s = yield* Scene.make(DashboardAdminPanelNoDeps, {
          ...panel('frontend-errors'),
          initialDocument: document,
        })

        expect(
          s.current.query(Locator.attr('aria-label', 'Browser and player health')),
        ).toBeDefined()
        expect(s.current.query(Locator.attr('aria-label', 'Errors'))?.tag).toBe('article')
        expect(
          s.current.query(
            Locator.inside(
              Locator.attr('aria-label', 'Navigation'),
              Locator.text('No events in this window.'),
            ),
          ),
        ).toBeDefined()
        expect(s.current.query(Locator.text('0.123', { exact: true }))).toBeDefined()
        expect(s.current.query(Locator.text('2,346 ms', { exact: true }))).toBeDefined()
        s.click('Refresh telemetry').loadFailed(
          'document',
          new DashboardRequestError({ message: 'Request failed.', status: 503 }),
        )
        expect(s.current.query(Locator.text('Try again', { exact: true }))).toBeDefined()
        expect(s.current.query(Locator.text('Request failed.', { exact: true }))).toBeDefined()
        expect(s.current.query(Locator.attr('aria-label', 'Web vitals'))).toBeUndefined()

        const empty = yield* Schema.decodeUnknownEffect(DashboardDocument)({
          ...emptyDocument,
          telemetry: {
            ...telemetry,
            state: 'empty',
            sections: Object.fromEntries(
              Object.keys(telemetry.sections).map((name) => [name, { available: true, rows: [] }]),
            ),
          },
        })

        s.click('Try again').loaded('document', empty)
        expect(
          s.current.query(
            Locator.text('No sampled browser telemetry was recorded in the last 24 hours.', {
              exact: true,
            }),
          ),
        ).toBeDefined()
      }),
    ),
  ))

it('preserves connection scope display, named disconnect and the successful-revocation receipt', () =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const document = yield* Schema.decodeUnknownEffect(DashboardDocument)({
          ...emptyDocument,
          connections: [
            {
              clientId: 'fixture-client',
              name: 'Fixture app',
              scopes: ['posts:read'],
              createdAt: '2026-09-27T10:00:00.000Z',
            },
          ],
        })

        const s = yield* Scene.make(DashboardAdminPanelNoDeps, {
          ...panel('connections'),
          initialDocument: document,
        })

        expect(s.current.query(Locator.attr('aria-label', 'Disconnect Fixture app'))?.tag).toBe(
          'button',
        )
        expect(s.current.query(Locator.attr('action', '/actions/connections/revoke'))?.tag).toBe(
          'form',
        )
        expect(s.current.query(Locator.text('posts:read', { exact: true }))).toBeDefined()

        const done = yield* Scene.make(DashboardAdminPanelNoDeps, {
          ...panel('connections'),
          url: '/dashboard/connections?notice=disconnected',
          initialDocument: { ...emptyDocument, connections: [] },
        })

        expect(done.current.query(Locator.text('App disconnected.', { exact: true }))).toBeDefined()
      }),
    ),
  ))
