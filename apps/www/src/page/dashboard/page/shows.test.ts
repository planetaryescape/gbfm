import { Effect, Predicate, Schema } from 'effect'
import { expect, test } from 'vitest'

import { emptyDocument } from '../document'
import { DashboardService, type DashboardRequest } from '../service'
import { initialModel, Message, Model, update } from './shows'

test('show deletion requires selecting an existing show and explicit confirmation', () => {
  expect(update(initialModel, Message.ConfirmDelete()).commands).toBeUndefined()
  expect(update(initialModel, Message.AskDelete({ slug: 'missing' })).model.deleting).toBeNull()
  const selected = { ...initialModel, deleting: 'a-show' }
  const cancelled = update(selected, Message.CancelDelete()).model
  expect(update(cancelled, Message.ConfirmDelete()).commands).toBeUndefined()
  const deletion = update(selected, Message.ConfirmDelete())
  expect(deletion.commands?.[0]).toMatchObject({ name: 'Shows.Delete', args: { slug: 'a-show' } })
  expect(update(deletion.model, Message.ConfirmDelete()).commands).toBeUndefined()
})

test('saving locks the submitted form and a failure preserves the original edit for retry', () => {
  const editing = {
    ...initialModel,
    editor: Model.fields.editor.cases.Editing.make({ slug: 'original-slug' }),
    draft: false,
    form: { ...initialModel.form, title: 'A new title', slug: 'renamed-slug' },
  }

  const saving = update(editing, Message.Save())
  expect(saving.commands?.[0]).toMatchObject({
    name: 'Shows.Save',
    args: { editing: 'original-slug', form: { slug: 'renamed-slug' }, draft: false },
  })
  expect(update(saving.model, Message.Clear()).model).toEqual(saving.model)
  expect(update(saving.model, Message.Save()).commands).toBeUndefined()
  const failed = update(saving.model, Message.Failed({ message: 'Unavailable' })).model
  expect(failed).toMatchObject({
    form: editing.form,
    editor: editing.editor,
    operation: 'idle',
    error: 'Unavailable',
  })
  expect(update(failed, Message.Save()).commands).toHaveLength(1)
})

test('the show form opens on demand and closes after a save', () => {
  const opened = update(
    { ...initialModel, form: { ...initialModel.form, title: 'Stale' } },
    Message.New(),
  ).model

  expect(Model.fields.editor.guards.Creating(opened.editor)).toBe(true)
  expect(opened.form).toEqual(initialModel.form)
  expect(update(opened, Message.Clear()).model.editor).toEqual(initialModel.editor)
  expect(update(opened, Message.Saved()).model.editor).toEqual(initialModel.editor)
})

test('show operations keep independent edit and deletion selections while serializing work', async () => {
  const listing = Schema.decodeUnknownSync(Model.fields.listing)({
    data: [
      {
        id: 'show',
        title: 'Show',
        slug: 'show',
        description: null,
        content: '',
        thumbnailUrl: null,
        bannerImageUrl: null,
        tags: [],
        draft: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        hosts: [],
      },
    ],
    pagination: { total: 1, limit: 25, offset: 0, hasMore: false },
  })

  const ready = { ...initialModel, listing }
  expect(update(ready, Message.Edit({ slug: 'missing' })).model).toBe(ready)
  const editing = update(ready, Message.Edit({ slug: 'show' })).model
  const asking = update(editing, Message.AskDelete({ slug: 'show' })).model
  expect(asking.editor).toEqual(editing.editor)
  const cancel = update(asking, Message.CancelDelete()).model
  expect(cancel.editor).toEqual(editing.editor)
  expect(cancel.deleting).toBeNull()
  const requests: Array<DashboardRequest> = []

  const service = DashboardService.of({
    request: (request) =>
      Effect.sync(() => {
        requests.push(request)

        return { ...emptyDocument, shows: listing }
      }),
    readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
    writePlayerPreferences: () => Effect.void,
  })

  for (const message of [Message.Save(), Message.ConfirmDelete(), Message.Load({ offset: 25 })]) {
    const pending = update(asking, message)
    expect(pending.model.operation).not.toBe('idle')

    for (const blocked of [
      Message.New(),
      Message.Edit({ slug: 'show' }),
      Message.Clear(),
      Message.CancelDelete(),
      Message.Save(),
      Message.ConfirmDelete(),
      Message.Load({ offset: 0 }),
      Message.DraftChanged(),
      Message.FieldChanged({ field: 'title', value: 'Ignored' }),
    ])
      expect(update(pending.model, blocked)).toEqual({ model: pending.model })
    const command = pending.commands?.[0]

    if (!command) throw new Error('Expected show command')

    const result = await Effect.runPromise(
      command.effect.pipe(Effect.provideService(DashboardService, service)),
    )

    const completed = update(pending.model, result)

    expect(completed.model.operation).toBe(
      Predicate.isTagged(result, 'Loaded') ? 'idle' : 'loading',
    )
    expect(completed.model.editor).toEqual(
      Predicate.isTagged(result, 'Loaded') ? editing.editor : initialModel.editor,
    )
  }

  expect(requests.map(({ method = 'GET' }) => method)).toEqual(['PATCH', 'DELETE', 'GET'])
})
