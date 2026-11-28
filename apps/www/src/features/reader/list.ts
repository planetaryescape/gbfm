import { ReaderListCard, tweetHref } from './cards'
import { ReaderPageMessage, type ReaderPageModel } from './contracts'
import { initialReader, isEntry } from './decisions'
import { ReaderPageDef } from './definition'
import { FollowReaderEntry } from './mounts'

export const ReaderList = ReaderPageDef.fragment((h, model: ReaderPageModel) => {
  const identity = h.props.principal?.id ?? 'anonymous'

  if (model.identity !== identity) model = initialReader(identity)
  const resumeSlug = model.resumeSlug ?? model.checkpoint

  if (h.props.status === 404 && !isEntry(h.props.url) && !model.entryFallback)
    return h.section.children(
      h.h1.class('text-2xl font-bold').children('Tweet not found.'),
      h.a.attr('href', '/tweet/latest').class('btn').children('Latest'),
    )

  return h.div.class('space-y-4').children(
    h.h1.class('text-2xl font-bold').children('Tweets'),
    h.form
      .attrs({ method: 'get', action: '/tweets' })
      .class('flex gap-2')
      .children(
        h.input
          .attrs({
            type: 'search',
            name: 'q',
            value: h.props.url.searchParams.get('q') ?? '',
            'aria-label': 'Search tweets',
          })
          .class('border border-input bg-background px-3 py-2'),
        h.button.attr('type', 'submit').class('btn').children('Search'),
      ),
    (model.entryResolved || model.entryFallback) &&
      h.a
        .attr('href', resumeSlug ? tweetHref(resumeSlug) : '/tweet/latest')
        .onMount(
          FollowReaderEntry({
            href: resumeSlug ? tweetHref(resumeSlug) : '/tweet/latest',
            enabled:
              h.props.active !== false &&
              h.props.principalKnown !== false &&
              ((isEntry(h.props.url) && model.entryResolved) || model.entryFallback),
          }),
        )
        .class('btn btn-primary')
        .children(resumeSlug ? 'Resume reading' : 'Start reading'),
    h.a
      .attr('href', '/tweet/latest')
      .class('btn')
      .on('click', ReaderPageMessage.ClickedLatest())
      .children('Latest'),
    h.props.failure && h.p.attr('role', 'alert').children(h.props.failure),
    h.props.posts.map((post) => ReaderListCard(h, post)),
    !h.props.failure && h.props.posts.length === 0 && h.p.children('No tweets found.'),
  )
})
