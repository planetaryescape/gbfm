import { Match, Schema } from 'effect'

import {
  CreatorDraftSchema,
  CreatorIdentity,
  type CreatorDraft,
  type CreatorKind,
} from './services'

export const Kind = Schema.Literals(['micro', 'post', 'mix'])

export const sameDraft = Schema.toEquivalence(CreatorDraftSchema)

export const appendBlock = (content: string, block: string) =>
  content.trim() ? `${content.replace(/\s+$/, '')}\n\n${block}` : block

export const tweetSlug = (value: string) =>
  /(?:https?:\/\/[^\s/]+)?\/tweet\/([a-z0-9-]+)/i.exec(value.trim())?.[1] ?? null

export const Field = Schema.Literals([
  'title',
  'slug',
  'content',
  'description',
  'thumbnailUrl',
  'musicUrl',
  'quoteUrl',
  'audioUrl',
])

export const SavedContent = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  updatedAt: Schema.optional(Schema.String),
})

export const Editable = Schema.Struct({
  ...CreatorDraftSchema.fields,
  draft: Schema.Boolean,
  creators: Schema.Array(CreatorIdentity),
})

export const selection = (url: string) => {
  const parsed = new URL(url, 'https://gbfm.local')

  const requested =
    parsed.searchParams.get('kind') ??
    parsed.searchParams.get('type') ??
    parsed.pathname.split('/')[2]

  let kind: CreatorKind = 'micro'

  if (requested === 'mix' || parsed.pathname === '/mix-upload') kind = 'mix'

  if (requested === 'post' || requested === 'editorial') kind = 'post'

  return { kind, slug: parsed.searchParams.get('edit') ?? parsed.searchParams.get('slug') }
}

export const emptyDraft = (
  kind: CreatorKind,
  id: string,
  editSlug: string | null = null,
): CreatorDraft => ({
  kind,
  editSlug,
  title: '',
  slug: '',
  content: '',
  description: '',
  tags: [],
  creatorIds: [id],
  thumbnailUrl: '',
  musicUrl: '',
  musicEntityType: null,
  musicEntityId: null,
  quotedPostId: null,
  quoteUrl: '',
  audioUrl: '',
  showId: null,
  episodeNumber: null,
})

export const draftKey = (id: string, draft: CreatorDraft, checkpointSlug = draft.editSlug) =>
  `${id}:${draft.kind}:${checkpointSlug ?? 'new'}`

export const savedEditorHref = (kind: CreatorKind, slug: string) => {
  const page = Match.value(kind).pipe(
    Match.when('micro', () => 'tweet'),
    Match.when('post', () => 'editorial'),
    Match.when('mix', () => 'mix'),
    Match.exhaustive,
  )

  return `/new/${page}?edit=${encodeURIComponent(slug)}`
}

export const validation = (draft: CreatorDraft) => {
  if (!draft.title.trim() && !draft.content.trim()) return 'Add a title or some content.'

  if (draft.kind === 'micro' && draft.title.length > 255)
    return 'Tweets are capped at 255 characters.'

  if (draft.kind === 'mix' && !draft.audioUrl) return 'Upload audio or add an audio URL.'

  return null
}

export const insertBanner = (content: string, url: string) => {
  const layout = content.match(/^(::layout\{[^\n]*\}[ \t]*\n?)/)?.[0] ?? ''

  const body = content
    .slice(layout.length)
    .replace(/^\s*!\[[^\]]*\]\([^\n)]*\)\s*\n?/, '')
    .trimStart()

  return `${layout}${layout && !layout.endsWith('\n') ? '\n' : ''}![Editorial artwork](${url})\n\n${body}`
}

export const publicHref = (draft: CreatorDraft) => {
  const section = Match.value(draft.kind).pipe(
    Match.when('micro', () => 'tweet'),
    Match.when('post', () => 'editorial'),
    Match.when('mix', () => 'mixes'),
    Match.exhaustive,
  )

  return `/${section}/${encodeURIComponent(draft.slug)}`
}
