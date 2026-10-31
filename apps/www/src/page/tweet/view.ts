import type { HtmlBuilder } from 'foldkit/html'

import type { Message } from '../../message'
import type { Model } from '../../model'
import { formatDate } from '../../view/format-date'
import {
  authorRow,
  cardActions,
  musicCard,
  parentPreview,
  quoteCard,
  replyCard,
  replySkeleton,
  tagLinks,
  tweetBody,
  type TweetPost,
} from './card'
import { readerHeader } from './dock'
import { tweetHeading } from './heading'
import { readerNotices } from './notices'

export const view = (model: Model, h: HtmlBuilder<Message>) => {
  const screen = model.flags.tweet

  if (!screen)
    return h.div(
      [h.Class('max-w-3xl px-4 pt-8 mx-auto')],
      [
        h.p([h.Role('alert')], [model.flags.failure ?? 'Tweet not found.']),
        h.a([h.Href('/tweet/latest')], ['Latest']),
      ],
    )
  const neighbours = model.interactive ? model.tweetReader.neighbours : model.flags.neighbours
  const chronological = model.flags.neighbours ?? neighbours
  const older = chronological?.older
  const post = screen.post
  const principal = model.flags.principal

  const canEdit = (candidate: TweetPost) =>
    Boolean(
      principal &&
      (principal.role === 'admin' ||
        candidate.creators?.some((creator) => creator.id === principal.id)),
    )

  const editedAt = post.updatedAt > post.createdAt ? post.updatedAt : null
  const replies = screen.replies

  const replyCount =
    model.repliesStatus === 'ready' ? replies.length : (post.replyCount ?? replies.length)

  const timelineNeighbours = neighbours ?? (model.interactive ? model.tweetReader.lastKnown : null)

  const navigation = readerHeader(h, {
    slug: post.slug,
    at: post.createdAt,
    newer: chronological?.newer,
    older,
    neighbours,
    timeline: timelineNeighbours,
    checking: model.interactive && model.tweetReader.metadataStatus === 'loading',
    failed: model.tweetReader.metadataStatus === 'error',
  })

  return h.div(
    [
      h.DataAttribute('tweet-swipe', post.slug),
      h.DataAttribute('swipe-ready', chronological ? 'true' : 'false'),
      h.Class('max-w-3xl px-4 pt-6 pb-8 mx-auto'),
    ],
    [
      h.div(
        [h.Class('mb-2 flex items-center gap-2')],
        [tweetHeading(post.createdAt, model.flags.renderedAt), navigation],
      ),
      h.p(
        [h.Class('mb-4 text-xs text-muted-foreground lg:hidden')],
        [
          chronological
            ? 'Swipe left for older · right for newer'
            : model.tweetReader.metadataStatus === 'error'
              ? 'Navigation unavailable · open Options to retry'
              : 'Loading navigation…',
        ],
      ),
      readerNotices(model, h, post.slug),
      h.div(
        [h.Class('tweet-swipe-viewport')],
        [
          h.div(
            [h.DataAttribute('tweet-motion', '')],
            [
              post.parentPostId && screen.root.id !== post.id
                ? parentPreview(screen.root)
                : h.empty,
              h.article(
                [
                  h.Class(
                    'space-y-4 rounded-lg border border-border/60 bg-card/60 p-4 shadow-sm sm:p-5 animate-in fade-in duration-300',
                  ),
                ],
                [
                  h.div(
                    [h.Class('space-y-1')],
                    [
                      authorRow(post.creators ?? [], post.createdAt),
                      editedAt
                        ? h.p(
                            [
                              h.Class(
                                'pl-[52px] font-mono text-[11px] tracking-wider text-muted-foreground/60',
                              ),
                            ],
                            [`Edited ${formatDate(editedAt)}`],
                          )
                        : h.empty,
                    ],
                  ),
                  post.title
                    ? h.h1(
                        [h.Class('m-0 text-lg font-medium leading-snug tracking-tight')],
                        [post.title],
                      )
                    : h.empty,
                  tweetBody(post, 'base'),
                  post.music ? musicCard(post.music, model, h, true) : h.empty,
                  screen.quote ? quoteCard(screen.quote) : h.empty,
                  post.tags?.length ? h.div([h.Class('pt-1')], [tagLinks(post.tags)]) : h.empty,
                  h.div(
                    [h.Class('border-t border-border/40 pt-3')],
                    [cardActions(post, canEdit(post), replyCount)],
                  ),
                ],
              ),
              h.div(
                [h.Id('replies'), h.Class('mt-6 scroll-mt-4 space-y-4')],
                [
                  principal
                    ? h.form(
                        [
                          h.Method('post'),
                          h.Action(`/actions/reply?slug=${encodeURIComponent(post.slug)}`),
                          h.Class('space-y-2 rounded-lg border border-border/60 bg-card/60 p-3'),
                        ],
                        [
                          h.textarea([
                            h.Name('content'),
                            h.Required(true),
                            h.Placeholder('Write a reply…'),
                            h.AriaLabel('Reply'),
                            h.Class(
                              'h-20 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm',
                            ),
                          ]),
                          h.div(
                            [h.Class('flex justify-end')],
                            [
                              h.button(
                                [h.Type('submit'), h.Class('btn btn-primary btn-sm')],
                                ['Reply'],
                              ),
                            ],
                          ),
                        ],
                      )
                    : h.p(
                        [h.Class('text-base')],
                        [
                          h.a(
                            [
                              h.Href(
                                `/auth/sign-in?returnTo=${encodeURIComponent(`/tweet/${post.slug}`)}`,
                              ),
                            ],
                            ['Sign in'],
                          ),
                          ' to reply',
                        ],
                      ),
                  model.repliesStatus === 'loading' && (post.replyCount ?? 2) > 0
                    ? replySkeleton(post.replyCount ?? 2)
                    : h.empty,
                  model.repliesStatus === 'error'
                    ? h.p(
                        [h.Role('alert'), h.Class('text-sm text-muted-foreground')],
                        ['Replies are unavailable. Please reload to try again.'],
                      )
                    : h.empty,
                  replies.length > 0
                    ? h.div(
                        [],
                        replies.map((reply, index) =>
                          replyCard(reply, index === replies.length - 1, canEdit(reply), model, h),
                        ),
                      )
                    : h.empty,
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}
