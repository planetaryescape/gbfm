import { canCreatePosts } from '@gbfm/core/roles'
import { Match, Option, Schema } from 'effect'

import type { Principal } from '../../domain/principal'
import { emptyDraft, Kind, validation } from './domain'
import { CreatorDraftSchema } from './services'

export type CreatorApiRequest = (
  request: Request,
  path: string,
  init?: RequestInit,
) => Promise<Response>

const failure = (message: string, status: number) =>
  new Response(message, {
    status,
    headers: { 'cache-control': 'private, no-store', 'content-type': 'text/plain; charset=utf-8' },
  })

export const handleCreatorFormAction = async (
  request: Request,
  principal: Principal | null,
  apiRequest: CreatorApiRequest,
): Promise<Response> => {
  if (!principal || !canCreatePosts(principal.role)) return failure('Forbidden', 403)
  const url = new URL(request.url)

  if (request.method !== 'POST' || request.headers.get('origin') !== url.origin)
    return failure('Forbidden', 403)
  const form = await request.formData().catch(() => null)

  if (!form) return failure('Invalid form submission.', 400)

  const field = (name: string) =>
    Option.getOrElse(Schema.decodeUnknownOption(Schema.String)(form.get(name)), () => '')

  const parsedKind = Schema.decodeUnknownOption(Kind)(field('kind'))

  if (Option.isNone(parsedKind)) return failure('Invalid content type.', 422)

  const kind = parsedKind.value

  const music = Schema.decodeUnknownOption(Schema.Literals(['album', 'track', 'playlist']))(
    field('musicEntityType'),
  )

  const candidate = {
    ...emptyDraft(kind, principal.id, field('editSlug') || null),
    title: field('title'),
    slug: field('slug'),
    content: field('content'),
    description: field('description'),
    thumbnailUrl: field('thumbnailUrl'),
    audioUrl: field('audioUrl'),
    expectedUpdatedAt: field('expectedUpdatedAt') || undefined,
    musicEntityType: Option.getOrNull(music),
    musicEntityId: field('musicEntityId') || null,
    quotedPostId: field('quotedPostId') || null,
    tags: field('tags')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    creatorIds: form
      .getAll('creatorIds')
      .flatMap((value) => Option.toArray(Schema.decodeUnknownOption(Schema.String)(value))),
    showId: field('showId') || null,
    episodeNumber: field('episodeNumber') ? Number(field('episodeNumber')) : null,
  }

  const decoded = Schema.decodeUnknownOption(CreatorDraftSchema)(candidate)

  if (Option.isNone(decoded)) return failure('Invalid draft fields.', 422)
  const draft = decoded.value

  const error = validation(draft)

  if (error) return failure(error, 422)

  if (
    draft.episodeNumber !== null &&
    (!Number.isSafeInteger(draft.episodeNumber) || draft.episodeNumber < 1)
  )
    return failure('Invalid episode number.', 422)
  const publish = field('intent') === 'publish'

  if (publish && field('confirmPublish') !== 'yes')
    return failure('Confirm that this content should be public.', 422)

  if (draft.kind === 'post' && draft.editSlug && !draft.expectedUpdatedAt)
    return failure('Reload the latest saved version before saving.', 409)
  const slug = draft.slug || `${draft.kind}-${crypto.randomUUID()}`
  const path = draft.kind === 'mix' ? '/api/content/audio' : '/api/content/post'

  const editPath =
    draft.kind === 'mix'
      ? `/api/content/audio/mix/${encodeURIComponent(draft.editSlug ?? '')}`
      : `/api/content/posts/${encodeURIComponent(draft.editSlug ?? '')}`

  const common = {
    title: draft.title || null,
    slug,
    content: draft.content || null,
    description: draft.description,
    thumbnailUrl: draft.thumbnailUrl,
    tags: draft.tags,
    type: kind,
    draft: !publish,
    creatorIds: draft.creatorIds.length ? draft.creatorIds : [principal.id],
    expectedUpdatedAt: draft.expectedUpdatedAt,
    musicEntityType: draft.musicEntityType,
    musicEntityId: draft.musicEntityId,
    quotedPostId: draft.editSlug ? undefined : draft.quotedPostId,
  }

  const payload =
    kind === 'mix'
      ? {
          ...common,
          title: draft.title,
          content: draft.content,
          url: draft.audioUrl,
          showId: draft.showId ?? undefined,
          episodeNumber: draft.episodeNumber ?? undefined,
          idempotencyKey: draft.editSlug ? undefined : crypto.randomUUID(),
        }
      : common

  const response = await apiRequest(request, draft.editSlug ? editPath : path, {
    method: draft.editSlug ? 'PATCH' : 'POST',
    headers: { 'content-type': 'application/json', origin: url.origin },
    signal: request.signal,
    body: JSON.stringify(payload),
  }).catch(() => failure('Could not reach the content service.', 503))

  if (!response.ok) {
    const reason =
      response.status === 409
        ? 'This content changed elsewhere. Your submitted writing has not overwritten it.'
        : 'Could not save content.'

    return failure(
      `${reason}\n\nYour submitted title:\n${draft.title}\n\nYour submitted body:\n${draft.content}`,
      response.status,
    )
  }

  const saved: unknown = await response.json().catch(() => null)
  const parsed = Schema.decodeUnknownOption(Schema.Struct({ slug: Schema.String }))(saved)

  if (Option.isNone(parsed)) return failure('The server returned an invalid saved result.', 502)

  const editorKind = Match.value(kind).pipe(
    Match.when('post', () => 'editorial'),
    Match.when('micro', () => 'tweet'),
    Match.orElse(() => 'mix'),
  )

  const location = `/new/${editorKind}?edit=${encodeURIComponent(parsed.value.slug)}`
  const headers = new Headers({ location, 'cache-control': 'private, no-store' })

  for (const cookie of response.headers.getSetCookie()) headers.append('set-cookie', cookie)

  return new Response(null, { status: 303, headers })
}
