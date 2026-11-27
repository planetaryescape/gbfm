import { Component, Subscription } from '@effect/ui'
import { HtmlCommand, HtmlSubscription } from '@effect/ui/html'
import { Layer, Stream } from 'effect'

import { readerCommandsLayer, RecordVisit, ResolveCheckpoint, StoreCheckpoint } from './commands'
import { destination, ReaderPageMessage } from './contracts'
import {
  commitVisit,
  concreteSlug,
  hasPendingVisits,
  initialReader,
  isEntry,
  matchesReservation,
  readerStatus,
  reserveVisit,
  settleVisit,
} from './decisions'
import { ReaderPageDef } from './definition'
import { ReaderDetail } from './detail'
import { ReaderList } from './list'
import { ReaderArticle, TrackReader } from './mounts'
import { ReaderNeighbours, ReaderReplies } from './requests'

export const ReaderPageNoDeps = ReaderPageDef.make({
  init: ($) => {
    const token = destination($.props)

    return $.set({
      ...reserveVisit(initialReader(token.identity), token),
      lastTimeline: $.props.neighbours?.timeline ?? [],
    })
  },
  update: {
    ChangedDestination: ($, token) => {
      const expected = destination($.props)

      if (
        token.identity !== expected.identity ||
        token.slug !== expected.slug ||
        token.navigationId !== expected.navigationId
      )
        return $.model
      const next = reserveVisit($.model, token)

      if (
        $.props.active !== false &&
        $.props.status === 404 &&
        next.resumeSlug &&
        next.resumeNavigationId === ($.props.navigationId ?? 0) - 1 &&
        concreteSlug($.props.url) === next.resumeSlug
      )
        return $.set({
          ...next,
          checkpoint: null,
          resumeSlug: null,
          resumeNavigationId: null,
          entryFallback: true,
        }).run(StoreCheckpoint.make({ identity: next.identity, slug: null }))

      if ($.props.active !== false && isEntry($.props.url) && next.checkpoint)
        return $.set({
          ...next,
          resumeSlug: next.checkpoint,
          resumeNavigationId: $.props.navigationId ?? 0,
          entryResolved: true,
        })

      return $.set(next)
    },
    CommittedReader: ($, token) => {
      const expected = destination($.props)

      if (
        token.identity !== expected.identity ||
        token.slug !== expected.slug ||
        token.navigationId !== expected.navigationId ||
        !token.slug
      )
        return $.model
      const reserved = reserveVisit($.model, token)
      const next = commitVisit(reserved, token)

      if (next === reserved) return $.set(reserved)

      let step = $.set(next).run(
        StoreCheckpoint.make({ identity: token.identity, slug: token.slug }),
      )

      if (token.navigationId > 0 && $.props.navigationAction !== 'pop')
        step = step.run(
          HtmlCommand.focus(ReaderArticle, () => Component.noop, { preventScroll: true }),
        )

      return next.revision !== reserved.revision ? step.run(RecordVisit.make(token)) : step
    },
    SucceededRecordVisit: ($, token) => $.set(settleVisit($.model, token, true)),
    FailedRecordVisit: ($, token) => $.set(settleVisit($.model, token, false)),
    ClickedRetryVisit: ($) => {
      const slug = $.model.current

      if (!slug || $.model.visits[slug] !== 'failed') return $.model

      return $.evolve({
        visits: { ...$.model.visits, [slug]: 'pending' },
        visitNavigation: { ...$.model.visitNavigation, [slug]: $.model.navigationId },
        revision: $.model.revision + 1,
      }).run(
        RecordVisit.make({
          identity: $.model.identity,
          navigationId: $.model.navigationId,
          generation: $.model.generation,
          slug,
        }),
      )
    },
    ClickedRetryNavigation: ($) =>
      hasPendingVisits($.model) ? $.model : $.evolve({ refresh: $.model.refresh + 1 }),
    FocusedReaderWindow: ($) =>
      $.props.active !== false &&
      $.props.principalKnown !== false &&
      $.model.current !== null &&
      matchesReservation($.model, destination($.props)) &&
      !hasPendingVisits($.model)
        ? $.evolve({ refresh: $.model.refresh + 1 })
        : $.model,
    ClickedLatest: ($) => $.evolve({ returnSlug: $.model.returnSlug ?? $.model.current }),
    EnteredReader: ($) =>
      $.props.active !== false && isEntry($.props.url) && !$.model.entryResolved
        ? $.run(
            ResolveCheckpoint.make({
              identity: $.model.identity,
              generation: $.model.generation,
              navigationId: $.props.navigationId ?? 0,
            }),
          )
        : $.model,
    ReceivedNavigationSnapshot: ($, { snapshot }) =>
      snapshot &&
      matchesReservation($.model, snapshot) &&
      snapshot.generation === $.model.generation &&
      snapshot.revision === $.model.revision &&
      snapshot.refresh === $.model.refresh &&
      !hasPendingVisits($.model)
        ? $.evolve({ lastTimeline: snapshot.neighbours.timeline })
        : $.model,
    ResolvedCheckpoint: ($, { identity, generation, navigationId, slug }) =>
      identity === $.model.identity &&
      generation === $.model.generation &&
      navigationId === ($.props.navigationId ?? 0) &&
      $.props.active !== false &&
      $.model.current === null &&
      isEntry($.props.url)
        ? $.evolve({ resumeSlug: slug, resumeNavigationId: navigationId, entryResolved: true })
        : $.model,
    MeasuredProgress: ($, token) =>
      matchesReservation($.model, token) && token.generation === $.model.generation
        ? $.evolve({ progress: token.progress })
        : $.model,
  },
  subscriptions: ({ props, model }) => [
    props.active !== false &&
      props.principalKnown !== false &&
      model.current !== null &&
      matchesReservation(model, destination(props)) &&
      !hasPendingVisits(model) &&
      HtmlSubscription.onWindow('focus', () => ReaderPageMessage.FocusedReaderWindow()),
    Subscription.make(
      'readerDestination',
      [
        props.principal?.id ?? 'anonymous',
        props.navigationId ?? 0,
        destination(props).slug,
        props.active !== false,
        props.status ?? 200,
      ],
      () => Stream.succeed(ReaderPageMessage.ChangedDestination(destination(props))),
    ),
    isEntry(props.url) &&
      !model.entryResolved &&
      props.active !== false &&
      props.principalKnown !== false &&
      Subscription.make(
        'readerEntryCheckpoint',
        [model.identity, model.generation, props.navigationId ?? 0],
        () => Stream.succeed(ReaderPageMessage.EnteredReader()),
      ),
  ],
  view: (h, model) =>
    h.section
      .attrs({ hidden: (h.props.visible ?? h.props.active) === false ? '' : undefined })
      .attr('data-reader-active', String(h.props.active !== false))
      .attr('data-reader-request', String(h.props.navigationId ?? 0))
      .attr('data-reader-status', readerStatus(h.props))
      .onMount(
        TrackReader({
          ...destination(h.props),
          generation:
            model.identity === (h.props.principal?.id ?? 'anonymous')
              ? model.generation
              : model.generation + 1,
          active: h.props.active !== false && h.props.principalKnown !== false,
        }),
      )
      .class('mx-auto max-w-3xl space-y-4 px-4 py-6')
      .children(h.props.screen ? ReaderDetail(h, model) : ReaderList(h, model)),
})

export const ReaderPage = ReaderPageNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(readerCommandsLayer, ReaderNeighbours.layer, ReaderReplies.layer),
  ),
)
