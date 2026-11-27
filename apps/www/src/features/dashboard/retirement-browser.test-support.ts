import { Dialog } from '@effect/ui-kit/Dialog'
import { BrowserHost, Html } from '@effect/ui/html'
import { Effect, Schema } from 'effect'

import { PasswordConfirmation } from './password-confirmation'
import { DashboardSessions } from './sessions'

const mode = new URL(location.href).searchParams.get('mode')

const Fixture = Html.component({
  name: 'NativeDialogRetirementBrowserFixture',
  model: Schema.Boolean,
  message: Schema.Struct({ open: Schema.Boolean }),
}).make({
  init: () => false,
  update: ($, message) => $.set(message.open),
  view: (h, open) =>
    h.div.children(
      h.button
        .attr('id', 'open-dialog')
        .style({ position: 'fixed', right: '20px', bottom: '20px' })
        .on('click', { open: true })
        .children('Open fixture dialog'),
      mode === 'password'
        ? PasswordConfirmation(h, {
            open,
            verifying: false,
            error: null,
            cancelled: { open: false },
            settled: (next) => ({ open: next }),
          })
        : Dialog(h, {
            props: { open },
            view: (dialog) =>
              h.div.children(
                dialog
                  .portal(
                    h.dialog.style({
                      position: 'fixed',
                      inset: '0',
                      width: '100vw',
                      height: '100vh',
                      margin: '0',
                    }),
                  )
                  ?.children(
                    dialog
                      .viewport(h.div)
                      .style({ position: 'fixed', inset: '0' })
                      .children(
                        dialog
                          .popup(h.div)
                          .children(dialog.title(h.h2).children('Unrelated dialog')),
                      ),
                  ),
              ),
          }),
    ),
})

const root = document.getElementById('app')

if (!root) throw new Error('Missing native fixture root')

Effect.runFork(
  Effect.scoped(
    Effect.gen(function* () {
      if (mode === 'sessions') yield* BrowserHost.mountEffect(DashboardSessions, {}, root)
      else yield* BrowserHost.mountEffect(Fixture, {}, root)
      document.body.dataset.ready = 'true'

      return yield* Effect.never
    }),
  ),
)
