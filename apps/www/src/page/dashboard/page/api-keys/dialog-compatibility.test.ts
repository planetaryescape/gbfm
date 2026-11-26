import * as Dialog from '@foldkit/ui/dialog'
import { Schema } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'
import { Scene } from 'foldkit/test'
import { describe, expect, it } from 'vitest'

import { initialModel } from './model'

describe('password-manager dialog compatibility', () => {
  it('preserves the narrow overlay allowance through model decoding and dialog commands', () => {
    const model = Schema.decodeUnknownSync(Dialog.Model)(initialModel.passwordDialog)
    const opened = Dialog.open(model)

    expect(opened.commands?.[0]).toMatchObject({
      name: 'ShowDialog',
      args: { allowedOutsideSelectors: ['com-1password-button', 'com-1password-menu'] },
    })
  })

  it('leaves unrelated dialogs without an outside-element allowance', () => {
    const model = Dialog.init({ id: 'unrelated-dialog' })
    const opened = Dialog.open(model)

    expect(model.allowedOutsideSelectors).toBeUndefined()
    expect(opened.commands?.[0]?.args?.allowedOutsideSelectors).toBeUndefined()
  })

  it('preserves the overlay allowance when an open model mounts for resource reacquisition', () => {
    const model = Schema.decodeUnknownSync(Dialog.Model)(
      Dialog.open(initialModel.passwordDialog).model,
    )

    const acquisition = Dialog.AcquireResources({
      id: model.id,
      focusSelector: 'input[type="password"]',
      allowedOutsideSelectors: ['com-1password-button', 'com-1password-menu'],
    })

    expect(() =>
      Scene.scene(
        {
          update: Dialog.update,
          view: (model: Dialog.Model, h: HtmlBuilder<Dialog.Message>) =>
            Dialog.view(model, { toView: ({ dialog }) => h.dialog([...dialog], []) }, h),
        },
        Scene.given(model),
        Scene.Mount.expectExact(acquisition),
        Scene.Mount.resolve(acquisition, Dialog.Message.SucceededAcquireResources()),
      ),
    ).not.toThrow()
  })
})
