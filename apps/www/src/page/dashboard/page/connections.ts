import { McpConnection } from '@gbfm/api/mcp-connections'
import { Match, Schema } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'

import { Message } from '../message'

export const Model = Schema.TaggedUnion({
  Loading: {},
  Ready: { connections: Schema.Array(McpConnection) },
  Failed: { message: Schema.String },
})

export type Model = typeof Model.Type

export const initialModel = Model.cases.Loading.make({})

export const connectionsView = (model: Model, url: string, h: HtmlBuilder<Message>) =>
  h.section(
    [h.Class('dashboard-stack')],
    [
      h.p(
        [],
        [
          'Apps with read-only access to your gbfm posts. Disconnecting removes their access and requires a new connection to use them again.',
        ],
      ),
      Match.value(new URL(url).searchParams.get('notice')).pipe(
        Match.when('disconnected', () => h.p([h.Role('status')], ['App disconnected.'])),
        Match.when('failed', () =>
          h.p([h.Role('alert')], ['Could not disconnect this app. Please try again.']),
        ),
        Match.orElse(() => h.empty),
      ),
      Model.match(model, {
        Loading: () => h.p([h.Role('status')], ['Loading connections…']),
        Failed: ({ message }) =>
          h.div(
            [],
            [
              h.p([h.Role('alert')], [message]),
              h.button([h.OnClick(Message.LoadRequested())], ['Try again']),
            ],
          ),
        Ready: ({ connections }) =>
          !connections.length
            ? h.p([], ['No connected apps.'])
            : h.div(
                [h.Class('dashboard-stack')],
                connections.map((connection) =>
                  h.article(
                    [h.Class('dashboard-panel')],
                    [
                      h.h2([], [connection.name]),
                      h.p([], [connection.scopes.join(', ')]),
                      h.p([], [`Connected ${connection.createdAt}`]),
                      h.form(
                        [h.Method('post'), h.Action('/actions/connections/revoke')],
                        [
                          h.input([
                            h.Type('hidden'),
                            h.Name('clientId'),
                            h.Value(connection.clientId),
                          ]),
                          h.button([h.Type('submit')], ['Disconnect']),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
      }),
    ],
  )
