import * as Dialog from '@foldkit/ui/dialog'
import { Schema } from 'effect'
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
})
