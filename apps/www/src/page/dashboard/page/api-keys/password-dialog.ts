import * as Dialog from '@foldkit/ui/dialog'
import type { HtmlBuilder } from 'foldkit/html'

import { Message, type Model } from './model'

export const passwordDialog = (model: Model, h: HtmlBuilder<Message>) =>
  h.submodel({
    slotId: 'password-dialog',
    model: model.passwordDialog,
    view: Dialog.view,
    viewInputs: {
      hasDescription: true,
      toView: ({ dialog, panel, title, description, isVisible }) =>
        h.dialog(
          [...dialog, h.Class('overlay-dialog'), h.DataAttribute('key-password-dialog', '')],
          isVisible
            ? [
                h.div([h.Class('absolute inset-0 bg-black/80')]),
                h.section(
                  [
                    ...panel,
                    h.Class(
                      'absolute left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg',
                    ),
                  ],
                  [
                    h.form(
                      [h.DataAttribute('key-password-form', ''), h.Class('dashboard-form')],
                      [
                        h.h2(
                          [...title, h.Class('text-lg font-semibold')],
                          ['Confirm your password'],
                        ),
                        h.p(
                          [...description],
                          [
                            'Enter your account password to create this API key. Your key settings will stay as they are.',
                          ],
                        ),
                        h.label(
                          [],
                          [
                            'Password',
                            h.input([
                              h.Type('password'),
                              h.Name('password'),
                              h.Autocomplete('current-password'),
                              h.Required(true),
                              h.Disabled(model.verifyingPassword),
                            ]),
                          ],
                        ),
                        model.passwordError
                          ? h.p([h.Role('alert')], [model.passwordError])
                          : h.empty,
                        model.verifyingPassword
                          ? h.p([h.Role('status')], ['Verifying password and creating key…'])
                          : h.empty,
                        h.div(
                          [h.Class('flex flex-wrap justify-end gap-2')],
                          [
                            h.button(
                              [
                                h.Type('button'),
                                h.Class('btn btn-quiet'),
                                h.Disabled(model.verifyingPassword),
                                h.OnClick(Message.PasswordCancelled()),
                              ],
                              ['Cancel'],
                            ),
                            h.button(
                              [
                                h.Type('submit'),
                                h.Class('btn btn-primary'),
                                h.Disabled(model.verifyingPassword),
                              ],
                              ['Confirm and create key'],
                            ),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ]
            : [],
        ),
    },
    toParentMessage: (message) => Message.GotPasswordDialogMessage({ message }),
  })
