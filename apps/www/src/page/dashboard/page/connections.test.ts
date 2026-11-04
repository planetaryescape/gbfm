import { Effect, Option } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'
import { Scene } from 'foldkit/test'
import { expect, it } from 'vitest'

import { parseDashboardDocument } from '../document'
import { initialModel } from '../init'
import { Message } from '../message'
import { update } from '../update'
import { connectionsView, Model } from './connections'

const show = (model: Model, role: string, name: string | RegExp = /.*/) =>
  Scene.scene(
    {
      update: (model: Model) => ({ model }),
      view: (model: Model, h: HtmlBuilder<Message>) =>
        connectionsView(model, 'https://www.test/dashboard/connections', h),
    },
    Scene.given(model),
    Scene.tap(({ html }) =>
      expect(Option.isSome(Scene.getByRole(role, { name })(html))).toBe(true),
    ),
  )

it('renders a parsed connection and its disconnect form through the dashboard load transition', async () => {
  expect.assertions(2)

  const document = await Effect.runPromise(
    parseDashboardDocument('/api/user/mcp-connections', {
      connections: [
        {
          clientId: 'disposable-client',
          name: 'Disposable editor',
          scopes: ['posts:read'],
          createdAt: '2026-11-04T00:00:00Z',
        },
      ],
    }),
  )

  const loaded = update(
    initialModel('connections', { id: 'owner', role: 'admin' }),
    Message.Loaded({ document }),
  )

  show(loaded.model.connections, 'heading', 'Disposable editor')
  show(loaded.model.connections, 'button', 'Disconnect')
})

it('distinguishes loading and a failed load with retry', () => {
  show(Model.cases.Loading.make({}), 'status')
  show(Model.cases.Failed.make({ message: 'Connections are unavailable.' }), 'alert')
  show(Model.cases.Failed.make({ message: 'Connections are unavailable.' }), 'button', 'Try again')

  const failed = update(
    initialModel('connections', { id: 'owner', role: 'admin' }),
    Message.Failed({ message: 'Connections are unavailable.' }),
  )

  const retrying = update(failed.model, Message.LoadRequested())

  show(retrying.model.connections, 'status')
  expect(retrying.commands).toHaveLength(1)
})
