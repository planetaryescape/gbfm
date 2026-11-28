import { AsyncResult } from 'effect/reactivity'

import {
  AuthorRow,
  MusicCard,
  PostActions,
  PostBody,
  PostTags,
  QuoteCard,
  tweetHref,
} from './cards'
import { destination, type ReaderPageModel } from './contracts'
import { hasPendingVisits, initialReader, matchesReservation, visitedNeighbours } from './decisions'
import { ReaderPageDef } from './definition'
import { ReaderArticle } from './mounts'
import { ReaderNavigation } from './navigation'
import { monthOf, relativeAge } from './timeline'

export const ReaderDetail = ReaderPageDef.fragment((h, model: ReaderPageModel) => {
  const identity = h.props.principal?.id ?? 'anonymous'

  if (model.identity !== identity) model = initialReader(identity)
  const screen = h.props.screen

  if (!screen) return h.div
  const post = screen.post
  const live = matchesReservation(model, destination(h.props)) && model.current === post.slug
  const result = h.queries.neighbours
  const failed = live && AsyncResult.isFailure(result)

  const metadata =
    live && AsyncResult.isSuccess(result) && !hasPendingVisits(model)
      ? result.value.neighbours
      : null

  const initial =
    model.current === post.slug
      ? visitedNeighbours(h.props.neighbours, post.parentPostId ? null : monthOf(post.createdAt))
      : h.props.neighbours

  const neighbours = live ? metadata : initial
  const chronological = neighbours ?? initial
  const repliesResult = h.queries.replies

  const replies =
    live && AsyncResult.isSuccess(repliesResult) ? repliesResult.value : screen.replies

  const replyCount =
    live && AsyncResult.isSuccess(repliesResult)
      ? replies.length
      : (post.replyCount ?? replies.length)

  const random = h.props.url.searchParams.get('random')
  let hint = 'Swipe left for older · right for newer'

  if (!chronological)
    hint = failed ? 'Navigation unavailable · open Options to retry' : 'Loading navigation…'
  let readingStatus = 'loading'

  if (failed) readingStatus = 'error'
  else if (metadata) readingStatus = 'ready'

  return h.div
    .attr('data-tweet-swipe', post.slug)
    .attr(
      'data-swipe-ready',
      String(
        chronological !== null && h.props.active !== false && h.props.principalKnown !== false,
      ),
    )
    .attr('data-reading-status', readingStatus)
    .class('space-y-4')
    .children(
      h.p
        .class('font-mono text-xs text-muted-foreground')
        .children(relativeAge(post.createdAt, h.props.renderedAt)),
      random &&
        h.p
          .attr('role', 'alert')
          .class('text-sm text-destructive')
          .children(
            random === 'exhausted'
              ? 'Caught up. No unread tweets remain.'
              : 'Random unread is unavailable. Try again.',
          ),
      h.props.url.searchParams.get('reset') === 'failed' &&
        h.p
          .attr('role', 'alert')
          .class('text-sm text-destructive')
          .children('Reading history could not be reset. Try again.'),
      ReaderNavigation(
        h,
        model,
        post.slug,
        neighbours,
        chronological,
        live && !metadata && !failed,
        failed,
        chronological?.timeline ?? model.lastTimeline,
        monthOf(post.createdAt),
      ),
      h.p.class('text-xs text-muted-foreground lg:hidden').children(hint),
      h.progress
        .attr('max', '100')
        .attr('value', String(model.progress))
        .attr('aria-label', 'Reading progress')
        .class('h-1 w-full'),
      h.div
        .attr('data-reader-motion', '')
        .attr('data-tweet-motion', '')
        .class('space-y-4')
        .children(
          post.parentPostId && screen.root.id !== post.id && QuoteCard(h, screen.root),
          h.article
            .ref(ReaderArticle)
            .attr('data-reader-article', '')
            .attr('tabindex', '-1')
            .class('space-y-4 rounded-lg border border-border/60 bg-card/60 p-4 shadow-sm sm:p-5')
            .children(
              post.draft &&
                h.p.attr('role', 'status').children('Draft · only visible to authorised readers'),
              AuthorRow(h, post),
              post.updatedAt > post.createdAt &&
                h.p
                  .class('text-xs text-muted-foreground')
                  .children(
                    `Edited ${new Date(post.updatedAt).toLocaleDateString('en-US', { timeZone: 'UTC' })}`,
                  ),
              post.title && h.h1.class('text-lg font-medium').children(post.title),
              PostBody(h, post),
              post.music && MusicCard(h, post.music, h.props.principal?.id ?? 'anonymous', post.id),
              screen.quote && QuoteCard(h, screen.quote),
              PostTags(h, post.tags),
              PostActions(h, post, h.props.principal, replyCount),
            ),
          ReaderReplies(h, model),
        ),
    )
})

const ReaderReplies = ReaderPageDef.fragment((h, model: ReaderPageModel) => {
  const identity = h.props.principal?.id ?? 'anonymous'

  if (model.identity !== identity) model = initialReader(identity)
  const screen = h.props.screen

  if (!screen) return h.div
  const post = screen.post
  const live = matchesReservation(model, destination(h.props)) && model.current === post.slug
  const repliesResult = h.queries.replies

  const replies =
    live && AsyncResult.isSuccess(repliesResult) ? repliesResult.value : screen.replies

  return h.section
    .attr('id', 'replies')
    .class('scroll-mt-4 space-y-4')
    .children(
      h.h2.class('text-lg font-medium').children('Replies'),
      h.props.principal
        ? h.form
            .attrs({
              method: 'post',
              action: `/actions/reply?slug=${encodeURIComponent(post.slug)}`,
            })
            .class('space-y-2 rounded-lg border border-border p-3')
            .children(
              h.textarea
                .attrs({
                  name: 'content',
                  required: '',
                  placeholder: 'Write a reply…',
                  'aria-label': 'Reply',
                })
                .class('h-20 w-full border border-input bg-background p-3'),
              h.button.attr('type', 'submit').class('btn btn-primary').children('Reply'),
            )
        : h.p.children(
            h.a
              .attr('href', `/auth/sign-in?returnTo=${encodeURIComponent(tweetHref(post.slug))}`)
              .children('Sign in'),
            ' to reply',
          ),
      (!live || AsyncResult.isInitial(repliesResult)) &&
        (post.replyCount ?? 0) > replies.length &&
        h.p.attr('role', 'status').children('Loading replies…'),
      live &&
        AsyncResult.isFailure(repliesResult) &&
        h.p.attr('role', 'alert').children('Replies are unavailable. Please reload to try again.'),
      replies.map((reply) =>
        h.article.class('space-y-3 rounded-lg border border-border p-3').children(
          AuthorRow(h, reply),
          PostBody(h, reply),
          reply.music && MusicCard(h, reply.music, h.props.principal?.id ?? 'anonymous', reply.id),
          PostTags(h, reply.tags),
          PostActions(h, reply, h.props.principal, 0),
          h.a
            .attr('href', tweetHref(reply.slug))
            .class('btn btn-quiet')
            .children(reply.replyCount ? `Continue thread (${reply.replyCount})` : 'Open reply'),
        ),
      ),
    )
})
