import { canAuthorWithKey, canPublishWithKey } from '@gbfm/core/personal-access-keys'
import { isRole } from '@gbfm/core/roles'
import { defineView } from 'foldkit/submodel'

import { absoluteTime } from '../../ui'
import { IssueKey } from './issuance'
import { Message, type Model } from './model'
import { passwordDialog } from './password-dialog'

export const view = defineView<
  Model,
  Message,
  { readonly role: string | null; readonly userId: string }
>((model, inputs, h) => {
  const role = inputs.role && isRole(inputs.role) ? inputs.role : null
  const idle = model.phase === 'ready'

  const scopes = [
    { value: 'posts:read', label: 'Read your posts' },
    { value: 'posts:create', label: 'Create drafts' },
    { value: 'posts:update', label: 'Update drafts' },
    ...(canPublishWithKey(role)
      ? [{ value: 'posts:publish', label: 'Publish and change published posts' }]
      : []),
  ]

  return h.section(
    [h.Class('admin-page'), h.OnMount(IssueKey({ userId: inputs.userId }))],
    [
      h.p(
        [],
        [
          'Give scripts and agents access to your own posts. Keys do not grant access to music resolution, image uploads or account management.',
        ],
      ),
      model.error ? h.p([h.Role('alert')], [model.error]) : h.empty,
      model.notice ? h.p([h.Role('status')], [model.notice]) : h.empty,
      canAuthorWithKey(role)
        ? h.form(
            [h.Class('dashboard-panel dashboard-form'), h.DataAttribute('key-create-form', '')],
            [
              h.h2([], ['Create API key']),
              h.p(
                [],
                [
                  'Confirm your password to create a key. Keys expire after at most 90 days, with up to 10 active keys.',
                ],
              ),
              h.label(
                [],
                [
                  'Name',
                  h.input([
                    h.Name('name'),
                    h.Required(true),
                    h.Maxlength(80),
                    h.Placeholder('My writing agent'),
                    h.Autocomplete('off'),
                  ]),
                ],
              ),
              h.fieldset(
                [h.Class('api-key-permissions')],
                [
                  h.legend([], ['Permissions']),
                  ...scopes.map((scope) =>
                    h.label(
                      [],
                      [
                        h.input([h.Type('checkbox'), h.Name('scopes'), h.Value(scope.value)]),
                        scope.label,
                      ],
                    ),
                  ),
                ],
              ),
              h.label(
                [],
                [
                  'Expires after',
                  h.select(
                    [h.Name('expiresInSeconds')],
                    [
                      h.option([h.Value('2592000')], ['30 days']),
                      h.option([h.Value('3600')], ['1 hour']),
                      h.option([h.Value('86400')], ['1 day']),
                      h.option([h.Value('604800')], ['7 days']),
                      h.option([h.Value('7776000')], ['90 days']),
                    ],
                  ),
                ],
              ),
              h.button(
                [h.Type('submit'), h.Class('btn btn-primary'), h.Disabled(true)],
                ['Create key'],
              ),
              h.p([h.Role('status'), h.AriaLive('polite'), h.DataAttribute('key-status', '')], []),
              h.div([h.DataAttribute('key-secret', ''), h.Class('dashboard-form')], []),
            ],
          )
        : h.p(
            [],
            [
              'Creator access is required to create API keys. You can still view and revoke existing keys.',
            ],
          ),
      passwordDialog(model, h),
      h.div(
        [h.Class('flex items-center justify-between gap-3')],
        [
          h.h2([], ['Your API keys']),
          h.button(
            [
              h.Class('btn btn-secondary'),
              h.Disabled(!idle),
              h.OnClick(Message.Refresh({ offset: model.page?.pagination.offset ?? 0 })),
            ],
            ['Refresh keys'],
          ),
        ],
      ),
      model.phase !== 'ready'
        ? h.p([h.Role('status')], [model.phase === 'revoking' ? 'Revoking key…' : 'Loading keys…'])
        : h.empty,
      model.page?.data.length === 0
        ? h.p(
            [],
            [
              'No API keys yet. Create one for each script or agent so you can revoke access separately.',
            ],
          )
        : h.empty,
      ...(model.page?.data ?? []).map((key) =>
        h.article(
          [h.Key(key.id), h.Class('dashboard-panel dashboard-stack')],
          [
            h.h3([], [key.name]),
            h.code([h.Class('break-all')], [key.displayPrefix + '…']),
            h.p(
              [],
              [
                `${key.environment} · ${key.revokedAt ? 'Revoked' : new Date(key.expiresAt).getTime() <= Date.now() ? 'Expired' : 'Active'}`,
              ],
            ),
            h.p([], [key.scopes.join(', ')]),
            h.p(
              [],
              [`Created ${absoluteTime(key.createdAt)} · Expires ${absoluteTime(key.expiresAt)}`],
            ),
            h.p(
              [],
              [key.lastUsedAt ? `Last used ${absoluteTime(key.lastUsedAt)}` : 'Not used yet'],
            ),
            key.revokedAt
              ? h.p([], [`Revoked ${absoluteTime(key.revokedAt)}`])
              : model.confirming === key.id
                ? h.div(
                    [h.Class('dashboard-stack')],
                    [
                      h.p(
                        [],
                        [`Revoke “${key.name}”? Scripts using it will immediately lose access.`],
                      ),
                      h.div(
                        [h.Class('flex flex-wrap gap-2')],
                        [
                          h.button(
                            [
                              h.Class('btn btn-destructive'),
                              h.Disabled(!idle),
                              h.OnClick(Message.Revoke()),
                            ],
                            ['Confirm revoke'],
                          ),
                          h.button(
                            [
                              h.Class('btn btn-quiet'),
                              h.Disabled(!idle),
                              h.OnClick(Message.CancelRevoke()),
                            ],
                            ['Keep key'],
                          ),
                        ],
                      ),
                    ],
                  )
                : h.button(
                    [
                      h.Class('btn btn-secondary'),
                      h.Disabled(!idle),
                      h.OnClick(Message.ConfirmRevoke({ id: key.id })),
                    ],
                    ['Revoke key'],
                  ),
          ],
        ),
      ),
      model.page
        ? h.nav(
            [h.AriaLabel('API key pages'), h.Class('flex items-center gap-3')],
            [
              h.button(
                [
                  h.Class('btn btn-secondary'),
                  h.Disabled(!idle || model.page.pagination.offset === 0),
                  h.OnClick(
                    Message.Refresh({ offset: Math.max(0, model.page.pagination.offset - 20) }),
                  ),
                ],
                ['Previous'],
              ),
              h.span([], [`${model.page.pagination.total} keys`]),
              h.button(
                [
                  h.Class('btn btn-secondary'),
                  h.Disabled(!idle || !model.page.pagination.hasMore),
                  h.OnClick(Message.Refresh({ offset: model.page.pagination.offset + 20 })),
                ],
                ['Next'],
              ),
            ],
          )
        : h.empty,
    ],
  )
})
