import { Schema } from 'effect'

import { MUSIC_PLATFORMS } from '@/db/music-entity.schema'

import { MusicEditId, MusicRevision } from '../music-edit/commands'

export const LinkTarget = Schema.Struct({
  entityType: Schema.Literals(['artist', 'album', 'track']),
  entityId: MusicEditId,
})

export const LinkPlatform = Schema.Literals(MUSIC_PLATFORMS)

const change = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal('attach_music_link'),
    platform: LinkPlatform,
    url: Schema.NonEmptyString.check(Schema.isMaxLength(2048)),
  }),
  Schema.Struct({ operation: Schema.Literal('reject_music_link'), linkId: MusicEditId }),
  Schema.Struct({ operation: Schema.Literal('remove_music_link'), linkId: MusicEditId }),
])

export const LinkEditCommand = Schema.Struct({
  ...LinkTarget.fields,
  requestId: Schema.String.check(
    Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  ),
  expectedRevision: MusicRevision,
  change,
})

export type LinkEditCommand = typeof LinkEditCommand.Type

const request = {
  ...LinkTarget.fields,
  requestId: LinkEditCommand.fields.requestId,
  expectedRevision: MusicRevision,
}

export const AttachLinkInput = Schema.Struct({
  ...request,
  platform: LinkPlatform,
  url: Schema.NonEmptyString.check(Schema.isMaxLength(2048)),
})

export const ReleaseLinkInput = Schema.Struct({ ...request, linkId: MusicEditId })

const receipt = Schema.Struct({
  status: Schema.Literals(['applied', 'replayed']),
  operationId: Schema.String,
  createdAt: Schema.Int,
  expiresAt: Schema.Int,
  outcome: Schema.Struct({
    result: Schema.Struct({
      ...LinkTarget.fields,
      operation: Schema.Literals(['attach_music_link', 'reject_music_link', 'remove_music_link']),
    }),
    revision: Schema.Struct({ ...LinkTarget.fields, revision: MusicRevision }),
    access: LinkTarget,
  }),
})

/** An object root is required by the official MCP SDK, even for a union result. */
export const LinkEditResult = Schema.Struct({
  result: Schema.Union([
    receipt,
    Schema.Struct({
      status: Schema.Literals([
        'conflict',
        'not_found',
        'expired',
        'access_denied',
        'invalid_input',
        'unavailable',
      ]),
    }),
  ]),
})
