import { Effect, Schema } from 'effect'

import { omitUndefined } from '@/lib/omit-undefined'
import { McpToolError } from '@/mcp/contracts'

import {
  CancelReminderCommandInput,
  CreateReminderCommandInput,
  RescheduleReminderCommandInput,
  UpdateReminderCommandInput,
} from './contracts'

const Command = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal('update_music_reminder'),
    input: UpdateReminderCommandInput,
  }),
  Schema.Struct({
    operation: Schema.Literal('create_music_reminder'),
    input: CreateReminderCommandInput,
  }),
  Schema.Struct({
    operation: Schema.Literal('reschedule_music_reminder'),
    input: RescheduleReminderCommandInput,
  }),
  Schema.Struct({
    operation: Schema.Literal('cancel_music_reminder'),
    input: CancelReminderCommandInput,
  }),
])

const Envelope = Schema.Struct({
  operation: Schema.Literals([
    'create_music_reminder',
    'reschedule_music_reminder',
    'cancel_music_reminder',
    'update_music_reminder',
  ]),
  input: Schema.Struct({ expectedRevision: Schema.optionalKey(Schema.Unknown) }),
})

const invalid = () =>
  new McpToolError({ code: 'invalid_input', message: 'Invalid reminder command.' })

/**
 * Parse and normalize before shared receipt hashing. This prepares an intent;
 * it does not persist, schedule, authorize replay, or claim receipt atomicity.
 * Never log the canonical payload: it can contain private URLs and notes.
 */
export const prepareReminderCommand = Effect.fn('prepareReminderCommand')(function* (
  raw: Schema.Json,
) {
  const envelope = yield* Schema.decodeUnknownEffect(Envelope)(raw).pipe(Effect.mapError(invalid))

  if (
    envelope.operation !== 'create_music_reminder' &&
    envelope.input.expectedRevision === undefined
  )
    return yield* new McpToolError({
      code: 'precondition_required',
      message: 'Use the command revision observed when reading this reminder.',
    })

  const command = yield* Schema.decodeUnknownEffect(Command, { onExcessProperty: 'error' })(
    raw,
  ).pipe(Effect.mapError(invalid))

  switch (command.operation) {
    case 'update_music_reminder': {
      const input = command.input

      const payload = omitUndefined({
        reminderId: input.reminderId.toLowerCase(),
        expectedRevision: input.expectedRevision,
        musicTitle: input.musicTitle,
        artistName: input.artistName,
        musicUrl: input.musicUrl,
        albumCoverUrl: input.albumCoverUrl,
        notes: input.notes,
        reminderDate:
          input.reminderDate === undefined ? undefined : new Date(input.reminderDate).toISOString(),
      })

      if (Object.keys(payload).length === 2) return yield* invalid()

      return {
        operation: command.operation,
        requestId: input.requestId.toLowerCase(),
        payload,
        canonicalPayload: JSON.stringify([command.operation, payload]),
      }
    }

    case 'create_music_reminder': {
      const input = command.input

      const payload = omitUndefined({
        musicTitle: input.musicTitle,
        artistName: input.artistName,
        musicUrl: input.musicUrl,
        albumCoverUrl: input.albumCoverUrl,
        reminderDate: new Date(input.reminderDate).toISOString(),
        notes: input.notes,
      })

      return {
        operation: command.operation,
        requestId: input.requestId.toLowerCase(),
        payload,
        canonicalPayload: JSON.stringify([command.operation, payload]),
      }
    }

    case 'reschedule_music_reminder': {
      const input = command.input

      const payload = {
        reminderId: input.reminderId.toLowerCase(),
        expectedRevision: input.expectedRevision,
        reminderDate: new Date(input.reminderDate).toISOString(),
      }

      return {
        operation: command.operation,
        requestId: input.requestId.toLowerCase(),
        payload,
        canonicalPayload: JSON.stringify([command.operation, payload]),
      }
    }

    default: {
      const input = command.input

      const payload = {
        reminderId: input.reminderId.toLowerCase(),
        expectedRevision: input.expectedRevision,
      }

      return {
        operation: command.operation,
        requestId: input.requestId.toLowerCase(),
        payload,
        canonicalPayload: JSON.stringify([command.operation, payload]),
      }
    }
  }
})
