import * as Button from '@foldkit/ui/button'
import { Match } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'

import { Message } from './message'
import { draftValidationError, type Model } from './model'

export const composerActions = (
  model: Model,
  h: HtmlBuilder<typeof Message.Type>,
  busy: boolean,
  canContinue: boolean,
  publicPath: string,
) => {
  const validationError = draftValidationError(model.draft)

  return h.header(
    [h.Class('creator-header')],
    [
      h.div(
        [h.Class('creator-status')],
        [
          model.draft.editSlug
            ? h.a(
                [h.Href(`/${publicPath}/${model.draft.editSlug}`), h.Class('btn btn-quiet btn-sm')],
                ['← Back to post'],
              )
            : h.empty,
          h.span(
            [
              h.Role('status'),
              h.AriaLive('polite'),
              h.DataAttribute('save-state', model.saveState),
            ],
            [
              model.remoteSave !== null
                ? 'Saving…'
                : Match.value(model.saveState).pipe(
                    Match.when('saved-locally', () => 'Draft saved locally'),
                    Match.when('saved', () => 'All changes saved'),
                    Match.when('unsaved', () => 'Unsaved changes'),
                    Match.when('failed', () => 'Not saved'),
                    Match.exhaustive,
                  ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('creator-actions')],
        [
          validationError && !busy
            ? h.small(
                [h.Id('creator-continue-hint'), h.Class('creator-actions-hint')],
                [validationError],
              )
            : h.empty,
          Button.view(
            {
              onClick: Message.DiscardRequested(),
              isDisabled: busy,
              toView: ({ button }) => h.button([...button, h.Class('btn btn-quiet')], ['Discard']),
            },
            h,
          ),
          Button.view(
            {
              onClick: Message.DraftSaveRequested(),
              isDisabled: busy || !canContinue,
              toView: ({ button }) =>
                h.button(
                  [
                    ...button,
                    h.Class('btn'),
                    ...(validationError ? [h.AriaDescribedBy('creator-continue-hint')] : []),
                  ],
                  ['Save draft'],
                ),
            },
            h,
          ),
          Button.view(
            {
              onClick: Message.ReviewRequested(),
              isDisabled: busy || !canContinue,
              toView: ({ button }) =>
                h.button(
                  [
                    ...button,
                    h.Class('btn btn-primary'),
                    ...(validationError ? [h.AriaDescribedBy('creator-continue-hint')] : []),
                  ],
                  ['Continue'],
                ),
            },
            h,
          ),
        ],
      ),
    ],
  )
}
