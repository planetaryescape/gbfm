import { expect, test } from 'vitest'

import { init, load, Message, update } from './index'

const target = { kind: 'audio', id: 'mix-a' } as const

const initial = () => init({ target, path: '/mixes/mix-a', state: 'inactive' }, 'listener')

test('public actions cannot toggle before an owner-matching atomic state observation', () => {
  const model = initial()
  expect(update(model, Message.Toggle())).toEqual({ model })
  const pending = load(model)
  expect(pending.model).toMatchObject({ busy: true, revision: null })
  expect(update(pending.model, Message.Toggle())).toEqual({ model: pending.model })

  const observed = {
    target,
    active: true,
    revision: 12,
    principalId: 'listener',
    requestId: pending.model.requestId,
  }

  for (const obsolete of [
    { ...observed, principalId: 'other' },
    { ...observed, target: { kind: 'audio', id: 'other-mix' } as const },
    { ...observed, requestId: observed.requestId - 1 },
  ]) {
    expect(update(pending.model, Message.Loaded(obsolete))).toEqual({ model: pending.model })
  }

  const ready = update(pending.model, Message.Loaded(observed)).model
  expect(ready).toMatchObject({ busy: false, revision: 12, document: { state: 'active' } })
  const saving = update(ready, Message.Toggle()).model
  expect(saving).toMatchObject({ busy: true, revision: 12 })

  const saved = update(
    saving,
    Message.Saved({ ...observed, active: false, revision: 13, requestId: saving.requestId }),
  ).model

  expect(saved).toMatchObject({
    busy: false,
    revision: 13,
    mutationId: null,
    document: { state: 'inactive' },
  })
})

test('uncertain saves retain their retry key; conflict reloads state without retrying the write', () => {
  const pending = load(initial()).model

  const ready = update(
    pending,
    Message.Loaded({
      target,
      principalId: 'listener',
      requestId: pending.requestId,
      active: false,
      revision: 3,
    }),
  ).model

  const saving = update(ready, Message.Toggle()).model
  const mutationId = 'cfe882f0-29aa-4321-850b-5c145fa8c387'

  const failed = update(
    saving,
    Message.Failed({
      target,
      principalId: 'listener',
      requestId: saving.requestId,
      mutationId,
      unauthorized: false,
      conflicted: false,
    }),
  ).model

  expect(failed).toMatchObject({ busy: false, mutationId, revision: 3 })
  const retry = update(failed, Message.Toggle()).model
  expect(retry).toMatchObject({ busy: true, mutationId, revision: 3 })

  const conflict = update(
    retry,
    Message.Failed({
      target,
      principalId: 'listener',
      requestId: retry.requestId,
      mutationId,
      unauthorized: false,
      conflicted: true,
    }),
  )

  expect(conflict.model).toMatchObject({ busy: true, revision: null, mutationId: null })
  expect(conflict.commands?.map(({ name }) => name)).toEqual(['PublicActions.Load'])

  const observed = update(
    conflict.model,
    Message.Loaded({
      target,
      principalId: 'listener',
      requestId: conflict.model.requestId,
      active: true,
      revision: 9,
    }),
  )

  expect(observed.model).toMatchObject({ busy: false, revision: 9, document: { state: 'active' } })
  expect(observed.commands).toBeUndefined()
})
