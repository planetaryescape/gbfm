import { Dialog } from '@effect/ui-kit/Dialog'
import type { Html } from '@effect/ui/html'
import { Predicate } from 'effect'

import { AllowPasswordManager } from './password-manager'
import { Notice } from './presentation'

export const PasswordConfirmation = <M>(
  h: Html.H<M>,
  options: {
    readonly open: boolean
    readonly verifying: boolean
    readonly error: string | null
    readonly cancelled: M
    readonly settled: (open: boolean) => M
  },
) =>
  Dialog(h, {
    props: { open: options.open, disablePointerDismissal: true },
    onEmit: (event) =>
      Predicate.isTagged(event, 'Settled') ? options.settled(event.open) : undefined,
    view: (dialog) =>
      h.div
        .key('key-password-dialog')
        .onMount(AllowPasswordManager({ open: options.open }))
        .children(
          dialog
            .portal(
              h.dialog
                .class('key-password-portal')
                .style({ minWidth: '100vw', minHeight: '100dvh' }),
            )
            ?.children(
              dialog.backdrop(h.div)?.class('dialog-backdrop'),
              dialog
                .viewport(h.div)
                .class('dialog-viewport')
                .children(
                  dialog
                    .popup(h.div)
                    .class('dialog-panel')
                    .children(
                      dialog.title(h.h2).children('Confirm your password'),
                      dialog
                        .description(h.p)
                        .children('Verify your password before creating this API key.'),
                      h.form
                        .attr('data-key-password-form', '')
                        .on('submit', () => undefined, { preventDefault: 'always' })
                        .on('keydown', ({ key, composing }) =>
                          key === 'Escape' && !composing ? options.cancelled : undefined,
                        )
                        .class('dashboard-form')
                        .children(
                          h.label.children(
                            'Password',
                            dialog
                              .initialFocus(h.input)
                              .attr('type', 'password')
                              .attr('name', 'password')
                              .attr('autocomplete', 'current-password')
                              .attr('required', '')
                              .disabled(options.verifying),
                          ),
                          Notice(h, options.error, true),
                          h.button
                            .attr('type', 'submit')
                            .disabled(options.verifying)
                            .children(options.verifying ? 'Verifying…' : 'Confirm and create key'),
                          dialog
                            .close(h.button)
                            .disabled(options.verifying)
                            .on('click', options.cancelled)
                            .children('Cancel'),
                        ),
                    ),
                ),
            ),
        ),
  })
