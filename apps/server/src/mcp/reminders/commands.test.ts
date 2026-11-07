import { Effect, type Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { prepareReminderCommand } from './commands'

const requestId = 'A1234567-89AB-4CDE-8FAB-0123456789AB'

const reminderId = 'b1234567-89ab-4cde-8fab-0123456789ab'

const create = {
  requestId,
  musicTitle: 'Night Mix',
  artistName: 'DJ',
  musicUrl: 'https://example.test/mix',
  reminderDate: '2028-02-29T13:04:05Z',
}

const prepare = (operation: string, input: Schema.Json) =>
  prepareReminderCommand({ operation, input })

const run = (operation: string, input: Schema.Json) => Effect.runPromise(prepare(operation, input))

const failure = (operation: string, input: Schema.Json) =>
  Effect.runPromise(Effect.flip(prepare(operation, input)))

describe('reminder command preparation (not receipt or scheduling acceptance)', () => {
  test('canonical create order and UTC precision are stable; request identity is separate', async () => {
    const first = await run('create_music_reminder', create)

    const reordered = await run('create_music_reminder', {
      reminderDate: '2028-02-29T13:04:05.000Z',
      musicUrl: create.musicUrl,
      artistName: 'DJ',
      musicTitle: 'Night Mix',
      requestId: requestId.toLowerCase(),
    })

    expect(first).toEqual(reordered)
    expect(first.requestId).toBe(requestId.toLowerCase())
    expect(first.canonicalPayload).toBe(
      '["create_music_reminder",{"musicTitle":"Night Mix","artistName":"DJ","musicUrl":"https://example.test/mix","reminderDate":"2028-02-29T13:04:05.000Z"}]',
    )

    const precise = await run('create_music_reminder', {
      ...create,
      reminderDate: '2028-02-29T13:04:05.1Z',
    })

    expect(precise.canonicalPayload).toContain('2028-02-29T13:04:05.100Z')
    expect(precise.canonicalPayload).not.toBe(first.canonicalPayload)
    expect(
      (await run('create_music_reminder', { ...create, requestId: reminderId })).canonicalPayload,
    ).toBe(first.canonicalPayload)

    for (const fields of [{ notes: null }, { notes: '' }, { albumCoverUrl: null }])
      expect(
        (await run('create_music_reminder', { ...create, ...fields })).canonicalPayload,
      ).not.toBe(first.canonicalPayload)
  })

  test('reschedule and cancel include observed revision, target and operation in payload identity', async () => {
    const input = { requestId, reminderId, expectedRevision: 7 }
    const cancel = await run('cancel_music_reminder', input)
    expect(cancel.canonicalPayload).toBe(
      `["cancel_music_reminder",{"reminderId":"${reminderId}","expectedRevision":7}]`,
    )
    expect(
      (await run('cancel_music_reminder', { ...input, expectedRevision: 8 })).canonicalPayload,
    ).not.toBe(cancel.canonicalPayload)
    expect(
      (await run('cancel_music_reminder', { ...input, reminderId: requestId })).canonicalPayload,
    ).not.toBe(cancel.canonicalPayload)
    expect(
      (await run('reschedule_music_reminder', { ...input, reminderDate: create.reminderDate }))
        .canonicalPayload,
    ).toBe(
      `["reschedule_music_reminder",{"reminderId":"${reminderId}","expectedRevision":7,"reminderDate":"2028-02-29T13:04:05.000Z"}]`,
    )

    for (const operation of ['reschedule_music_reminder', 'cancel_music_reminder']) {
      const date =
        operation === 'reschedule_music_reminder' ? { reminderDate: create.reminderDate } : {}

      expect(await failure(operation, { requestId, reminderId, ...date })).toMatchObject({
        code: 'precondition_required',
      })

      for (const expectedRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '7', null])
        expect(await failure(operation, { ...input, ...date, expectedRevision })).toMatchObject({
          code: 'invalid_input',
        })

      const maximum = await run(operation, {
        ...input,
        ...date,
        expectedRevision: Number.MAX_SAFE_INTEGER,
      })

      if (maximum.operation === 'create_music_reminder')
        throw new Error('Unexpected create command')
      expect(maximum.payload.expectedRevision).toBe(Number.MAX_SAFE_INTEGER)
    }
  })

  test('rejects normalized invalid dates, local/offset time, leap seconds and precision loss', async () => {
    for (const reminderDate of [
      '2027-02-29T13:04:05Z',
      '2028-02-30T13:04:05Z',
      '2028-04-31T13:04:05Z',
      '2028-02-29T24:00:00Z',
      '2028-02-29T13:04:60Z',
      '2028-02-29T13:04:05',
      '2028-02-29T13:04:05+00:00',
      '2028-02-29T13:04:05.0001Z',
    ])
      expect(await failure('create_music_reminder', { ...create, reminderDate })).toMatchObject({
        code: 'invalid_input',
      })
  })

  test('bounded metadata and excess-property rejection prevent caller-selected recipients/owners', async () => {
    for (const fields of [
      { userId: 'other' },
      { recipient: 'other@example.test' },
      { email: 'other@example.test' },
      { musicTitle: ' ' },
      { musicTitle: 'x'.repeat(501) },
      { notes: 'x'.repeat(2001) },
      { musicUrl: 'https://secret@example.test' },
      { musicUrl: 'javascript:alert(1)' },
      { musicUrl: `https://example.test/${'x'.repeat(4096)}` },
      { requestId: 'not-a-uuid' },
    ]) {
      const error = await failure('create_music_reminder', { ...create, ...fields })
      expect(error).toMatchObject({ code: 'invalid_input' })
      expect(JSON.stringify(error)).not.toContain('secret@example.test')
    }

    expect(
      (
        await run('create_music_reminder', {
          ...create,
          musicTitle: 'x'.repeat(500),
          notes: 'x'.repeat(2000),
        })
      ).operation,
    ).toBe('create_music_reminder')
  })
})
