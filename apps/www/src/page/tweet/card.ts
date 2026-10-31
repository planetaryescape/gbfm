import type { MicroPostScreenResponse } from '@gbfm/api/post'
import { inertHtml as h, type HtmlBuilder } from 'foldkit/html'

import { Message } from '../../message'
import type { Model } from '../../model'
import * as SpotifyPlayback from '../../spotify/playback'
import { artwork } from '../../view/artwork'
import { formatDate } from '../../view/format-date'
import { iconPaths, lucide, spotifyIcon } from '../../view/icons'
import { musicEntityLabels, musicPlatformLabel } from '../../view/music-platform'
import { richContent } from '../../view/rich-content/fallback'
import { richContentView } from '../../view/rich-content/render'

export type TweetPost = MicroPostScreenResponse['post']

const avatarSizes = '40px'

const coverSizes = '(min-width: 640px) 128px, 96px'

/** The artwork a tweet screen paints first, for warming the image cache before navigating to it. */
export const tweetImages = (screen: MicroPostScreenResponse) =>
  [screen.post, screen.quote, screen.post.parentPostId ? screen.root : null].flatMap((post) =>
    post
      ? [
          ...(post.creators?.[0] ? [{ src: post.creators[0].image, sizes: avatarSizes }] : []),
          ...(post.music ? [{ src: post.music.entity.coverImageUrl, sizes: coverSizes }] : []),
        ]
      : [],
  )

type Creator = NonNullable<TweetPost['creators']>[number]

const actionClassName = 'btn btn-quiet -mx-2'

const snippet = (text: string, max: number) => {
  const flattened = text.replace(/\s+/g, ' ').trim()

  return flattened.length > max ? `${flattened.slice(0, max).trimEnd()}…` : flattened
}

const profileHref = (username: string) => `/profile/${encodeURIComponent(username)}`

export const authorRow = (
  creators: ReadonlyArray<Creator>,
  createdAt: string | null,
  interactive = true,
) => {
  const creator = creators[0]

  if (!creator) return h.empty
  const username = interactive ? creator.username : null
  const date = createdAt ? formatDate(createdAt) : null

  const avatar = artwork(
    creator.image,
    `${creator.name}'s avatar`,
    avatarSizes,
    false,
    'h-10 w-10 object-cover',
  )

  return h.div(
    [h.Class('flex min-w-0 items-center gap-3')],
    [
      username
        ? h.a(
            [
              h.Href(profileHref(username)),
              h.Class(
                'shrink-0 overflow-hidden rounded-sm ring-1 ring-border/60 transition-transform hover:scale-[1.02]',
              ),
            ],
            [avatar],
          )
        : h.div([h.Class('shrink-0 overflow-hidden rounded-sm ring-1 ring-border/60')], [avatar]),
      h.div(
        [h.Class('min-w-0 leading-tight')],
        [
          username
            ? h.a(
                [
                  h.Href(profileHref(username)),
                  h.Class('block truncate font-bold text-foreground hover:underline'),
                ],
                [creator.name],
              )
            : h.span([h.Class('block truncate font-bold text-foreground')], [creator.name]),
          h.div(
            [h.Class('flex items-center gap-1.5 truncate text-base text-muted-foreground')],
            [
              creator.username
                ? username
                  ? h.a(
                      [
                        h.Href(profileHref(username)),
                        h.Class('truncate hover:text-foreground hover:underline'),
                      ],
                      [`@${creator.username}`],
                    )
                  : h.span([h.Class('truncate')], [`@${creator.username}`])
                : h.empty,
              creator.username && date
                ? h.span([h.AriaHidden(true), h.Class('text-muted-foreground/50')], ['·'])
                : h.empty,
              date
                ? h.span([h.Class('shrink-0 font-mono text-xs text-muted-foreground/70')], [date])
                : h.empty,
            ],
          ),
        ],
      ),
    ],
  )
}

const streamLinks = (links: NonNullable<TweetPost['music']>['links']) =>
  h.div(
    [h.Class('flex flex-wrap items-center gap-2 border-t border-border/40 px-4 py-3')],
    links.map((link) =>
      h.a(
        [
          h.Key(link.platform),
          h.Href(link.url),
          h.Target('_blank'),
          h.Rel('noopener noreferrer'),
          h.Class('btn'),
        ],
        [
          link.platform === 'spotify' ? spotifyIcon('h-3.5 w-3.5') : h.empty,
          musicPlatformLabel(link.platform),
          lucide(iconPaths.externalLink, 'h-3 w-3 opacity-40'),
        ],
      ),
    ),
  )

export const musicCard = (
  music: NonNullable<TweetPost['music']>,
  model: Model,
  h: HtmlBuilder<Message>,
  eager = false,
) =>
  h.article(
    [
      h.Key(music.entity.id),
      h.Class('not-prose min-w-0 overflow-hidden rounded-md border border-border/50 bg-muted/20'),
    ],
    [
      h.div(
        [h.Class('flex items-start gap-4 p-4 sm:gap-5')],
        [
          h.div(
            [
              h.Class(
                'flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-none bg-muted sm:size-32',
              ),
            ],
            [
              music.entity.coverImageUrl
                ? artwork(
                    music.entity.coverImageUrl,
                    music.entity.title,
                    coverSizes,
                    eager,
                    'size-full object-cover',
                  )
                : lucide(iconPaths.music, 'size-10 text-muted-foreground/70'),
            ],
          ),
          h.div(
            [h.Class('min-w-0 flex-1 space-y-2')],
            [
              h.p(
                [h.Class('text-[10px] font-bold tracking-[0.3em] text-muted-foreground/70')],
                [musicEntityLabels[music.entity.type]],
              ),
              h.h2(
                [
                  h.Class(
                    'm-0 break-words text-lg font-bold leading-snug tracking-tight text-foreground sm:text-xl',
                  ),
                ],
                [music.entity.title],
              ),
              music.entity.artistNames?.length
                ? h.p(
                    [h.Class('text-sm text-muted-foreground')],
                    [music.entity.artistNames.join(', ')],
                  )
                : h.empty,
            ],
          ),
        ],
      ),
      ...music.links
        .filter((link) => link.platform === 'spotify')
        .map((link) =>
          SpotifyPlayback.view(
            model.spotifyPlayback,
            h,
            (message) => Message.GotSpotifyPlaybackMessage({ message }),
            link.url,
            model.interactive,
          ),
        ),
      music.links.length > 0 ? streamLinks(music.links) : h.empty,
    ],
  )

export const tagLinks = (tags: ReadonlyArray<string>) =>
  tags.length === 0
    ? h.empty
    : h.div(
        [h.Class('flex flex-wrap items-center gap-x-3 gap-y-1')],
        tags.map((tag) =>
          h.a(
            [
              h.Key(tag),
              h.Href(`/tags/${encodeURIComponent(tag)}`),
              h.Class(
                'text-xs font-medium text-muted-foreground no-underline transition-colors hover:text-foreground',
              ),
            ],
            [`#${tag}`],
          ),
        ),
      )

export const quoteCard = (post: TweetPost) =>
  h.a(
    [
      h.Href(`/tweet/${encodeURIComponent(post.slug)}`),
      h.Class(
        'not-prose block overflow-hidden rounded-md border border-border/50 bg-muted/20 p-3 no-underline transition-colors hover:bg-muted/30',
      ),
    ],
    [
      authorRow(post.creators ?? [], post.createdAt, false),
      h.p(
        [h.Class('mt-2 truncate text-base text-muted-foreground')],
        [snippet(post.content ?? post.title ?? '', 180)],
      ),
    ],
  )

export const parentPreview = (post: TweetPost) =>
  h.div(
    [h.Class('pb-4')],
    [
      h.a(
        [
          h.Href(`/tweet/${encodeURIComponent(post.slug)}`),
          h.Class(
            'block overflow-hidden rounded-lg border border-border/40 bg-card p-3 no-underline opacity-80 transition-opacity hover:opacity-100',
          ),
        ],
        [
          authorRow(post.creators ?? [], post.createdAt, false),
          h.p(
            [h.Class('mt-2 truncate text-base text-muted-foreground')],
            [snippet(post.content ?? post.title ?? '', 140)],
          ),
        ],
      ),
      h.div(
        [h.Class('relative h-2')],
        [h.div([h.AriaHidden(true), h.Class('absolute left-5 top-0 h-2 w-px bg-border/60')], [])],
      ),
    ],
  )

export const cardActions = (post: TweetPost, canEdit: boolean, replyCount: number) =>
  h.div(
    [h.Class('flex items-center gap-4')],
    [
      canEdit
        ? h.a(
            [h.Href(`/new/tweet?edit=${encodeURIComponent(post.slug)}`), h.Class(actionClassName)],
            [lucide(iconPaths.edit, 'h-3.5 w-3.5'), 'Edit'],
          )
        : h.empty,
      replyCount > 0
        ? h.a(
            [h.Href('#replies'), h.Class(actionClassName)],
            [
              lucide(iconPaths.replies, 'h-3.5 w-3.5'),
              `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`,
            ],
          )
        : h.empty,
    ],
  )

export const tweetBody = (post: TweetPost, size: 'base' | 'sm') =>
  post.richContent
    ? richContentView(post.richContent, h, {
        className: `prose ${size === 'base' ? 'prose-base' : 'prose-sm'} dark:prose-invert max-w-none prose-headings:font-black prose-headings:tracking-tighter prose-p:leading-relaxed prose-p:my-0 prose-a:text-foreground prose-a:underline`,
      })
    : richContent(
        post.content ?? '',
        `prose ${size === 'base' ? 'prose-base' : 'prose-sm'} dark:prose-invert max-w-none prose-headings:font-black prose-headings:tracking-tighter prose-p:leading-relaxed prose-p:my-0 prose-a:text-foreground prose-a:underline`,
      )

export const replyCard = (
  reply: TweetPost,
  isLast: boolean,
  canEdit: boolean,
  model: Model,
  h: HtmlBuilder<Message>,
) =>
  h.div(
    [h.Key(reply.id), h.Class('relative')],
    [
      isLast
        ? h.empty
        : h.div(
            [h.AriaHidden(true), h.Class('absolute left-[35px] top-full h-2 w-px bg-border/60')],
            [],
          ),
      h.article(
        [
          h.Class(
            `relative space-y-2 rounded-lg border border-border/40 bg-card p-3 transition-colors hover:bg-card/80 [&_a]:relative [&_a]:z-10 ${isLast ? '' : 'mb-2'}`,
          ),
        ],
        [
          h.a(
            [
              h.Href(`/tweet/${encodeURIComponent(reply.slug)}`),
              h.AriaLabel(`Open reply by ${reply.creators?.[0]?.name ?? 'author'}`),
              h.Class('absolute! inset-0 z-0!'),
            ],
            [],
          ),
          authorRow(reply.creators ?? [], reply.createdAt),
          tweetBody(reply, 'sm'),
          reply.music ? musicCard(reply.music, model, h) : h.empty,
          tagLinks(reply.tags ?? []),
          h.div(
            [h.Class('flex items-center gap-4')],
            [
              cardActions(reply, canEdit, 0),
              reply.replyCount
                ? h.a(
                    [h.Href(`/tweet/${encodeURIComponent(reply.slug)}`), h.Class(actionClassName)],
                    [`Continue thread (${reply.replyCount})`],
                  )
                : h.empty,
            ],
          ),
        ],
      ),
    ],
  )

export const replySkeleton = (count: number) =>
  h.div(
    [h.Class('space-y-2'), h.Role('status'), h.AriaLabel('Loading replies')],
    Array.from({ length: Math.min(count, 3) }, (_, index) =>
      h.div(
        [
          h.Key(String(index)),
          h.Class('animate-pulse space-y-2 rounded-lg border border-border/40 bg-card/40 p-3'),
        ],
        [
          h.div(
            [h.Class('flex items-center gap-3')],
            [
              h.div([h.Class('h-10 w-10 rounded-sm bg-muted')], []),
              h.div([h.Class('h-3 w-24 rounded-full bg-muted')], []),
            ],
          ),
          h.div([h.Class('h-3 w-2/3 rounded-full bg-muted')], []),
          h.div([h.Class('h-3 w-16 rounded-full bg-muted/60')], []),
        ],
      ),
    ),
  )
