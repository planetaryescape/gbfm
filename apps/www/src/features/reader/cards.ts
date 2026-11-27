import type { Html } from '@effect/ui/html'
import type { CompiledPostResponse, MicroPostScreenPost } from '@gbfm/api/post'

import type { Principal } from '../../domain/principal'
import { artwork } from '../../ui/artwork'
import { richContent } from '../../ui/rich-content/fallback'
import { richContentView } from '../../ui/rich-content/render'
import { SpotifyActions } from '../spotify/actions'
import type { ReaderListItem } from './contracts'

export const tweetHref = (slug: string) => `/tweet/${encodeURIComponent(slug)}`

export const canEditPost = (principal: Principal | null, post: typeof CompiledPostResponse.Type) =>
  principal !== null &&
  (principal.role === 'admin' ||
    post.creators?.some((creator) => creator.id === principal.id) === true)

export const AuthorRow = <M>(h: Html.H<M>, post: typeof CompiledPostResponse.Type) =>
  h.header.class('flex items-center gap-3').children(
    (post.creators ?? []).map((creator) =>
      h.a
        .attr('href', creator.username ? `/profile/${encodeURIComponent(creator.username)}` : '#')
        .class('flex items-center gap-3')
        .children(
          artwork(
            h,
            creator.image,
            `${creator.name}'s avatar`,
            '40px',
            false,
            'size-10 rounded-sm object-cover',
          ),
          h.span.children(creator.name, creator.username ? ` @${creator.username}` : ''),
        ),
    ),
    h.time
      .attr('datetime', post.createdAt)
      .class('font-mono text-xs text-muted-foreground')
      .children(new Date(post.createdAt).toLocaleDateString('en-US', { timeZone: 'UTC' })),
  )

export const PostBody = <M>(h: Html.H<M>, post: typeof CompiledPostResponse.Type) =>
  post.richContent
    ? richContentView(h, post.richContent, { className: 'prose dark:prose-invert max-w-none' })
    : richContent(h, post.content ?? '', 'prose dark:prose-invert max-w-none')

export const PostTags = <M>(h: Html.H<M>, tags: ReadonlyArray<string> | null) =>
  h.div.class('flex flex-wrap gap-3').children(
    (tags ?? []).map((tag) =>
      h.a
        .attr('href', `/tags/${encodeURIComponent(tag)}`)
        .class('text-xs text-muted-foreground')
        .children(`#${tag}`),
    ),
  )

export const QuoteCard = <M>(h: Html.H<M>, post: MicroPostScreenPost) =>
  h.a
    .attr('href', tweetHref(post.slug))
    .class('block rounded-md border border-border p-3')
    .children(AuthorRow(h, post), h.p.children((post.content ?? post.title ?? '').slice(0, 180)))

export const MusicCard = <M>(
  h: Html.H<M>,
  music: NonNullable<MicroPostScreenPost['music']>,
  identity: string,
  ownerId: string,
) =>
  h.section.class('not-prose rounded-md border border-border bg-muted/20').children(
    h.div
      .class('flex gap-4 p-4')
      .children(
        artwork(
          h,
          music.entity.coverImageUrl,
          music.entity.title,
          '128px',
          true,
          'size-24 object-cover sm:size-32',
        ),
        h.div.children(
          h.p.class('text-xs uppercase tracking-wider').children(music.entity.type),
          h.h2.class('text-lg font-bold').children(music.entity.title),
          h.p.children(music.entity.artistNames?.join(', ') ?? ''),
        ),
      ),
    music.links
      .filter((link) => link.platform === 'spotify')
      .map((link) =>
        SpotifyActions(h, {
          key: `${identity}:${ownerId}:${link.url}`,
          props: { url: link.url },
        }),
      ),
    h.div
      .class('flex flex-wrap gap-3 p-4')
      .children(
        music.links.map((link) =>
          h.a
            .attrs({ href: link.url, target: '_blank', rel: 'noopener noreferrer' })
            .class('btn')
            .children(link.platform),
        ),
      ),
  )

export const PostActions = <M>(
  h: Html.H<M>,
  post: typeof CompiledPostResponse.Type,
  principal: Principal | null,
  replies: number,
) =>
  h.footer.class('flex gap-4 border-t border-border/40 pt-3').children(
    canEditPost(principal, post) &&
      h.a
        .attr('href', `/new/tweet?edit=${encodeURIComponent(post.slug)}`)
        .class('btn btn-quiet')
        .children('Edit'),
    replies > 0 &&
      h.a
        .attr('href', '#replies')
        .class('btn btn-quiet')
        .children(`${replies} ${replies === 1 ? 'reply' : 'replies'}`),
  )

export const ReaderListCard = <M>(h: Html.H<M>, post: typeof ReaderListItem.Type) => {
  if ('createdAt' in post)
    return h.article
      .class('space-y-3 rounded-lg border border-border p-4')
      .children(
        AuthorRow(h, post),
        post.title && h.h2.children(post.title),
        PostBody(h, post),
        PostTags(h, post.tags),
        h.a.attr('href', tweetHref(post.slug)).class('btn').children('Read tweet'),
      )

  return h.article
    .class('space-y-3 rounded-lg border border-border p-4')
    .children(
      post.draft && h.p.attr('role', 'status').children('Draft'),
      post.title && h.h2.children(post.title),
      post.meta && h.p.class('text-xs text-muted-foreground').children(post.meta),
      post.richContent ? richContentView(h, post.richContent) : richContent(h, post.content),
      h.a.attr('href', post.href).class('btn').children('Read tweet'),
    )
}
