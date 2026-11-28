import { Command, Component, Query, Router, Subscription, UiSchema } from '@effect/ui'
import { Dialog } from '@effect/ui-kit'
import { Html, HtmlSubscription } from '@effect/ui/html'
import { SearchResults, type SearchResultItem } from '@gbfm/api/search'
import { Effect, Layer, Predicate, Schema, Stream } from 'effect'

import { isPageUrl } from '../../app/route'
import { SearchOrigin, SearchQueryScope, searchScopeKey } from './scope'

export const resultHref = (item: SearchResultItem): string | null => {
  const prefixes = new Map([
    ['show', 'shows'],
    ['mix', 'mixes'],
    ['track', 'tracks'],
    ['micro', 'tweet'],
    ['post', 'editorial'],
  ])

  const prefix = prefixes.get(item.type)

  if (prefix) return `/${prefix}/${encodeURIComponent(item.slug)}`

  return item.showSlug ? `/shows/${encodeURIComponent(item.showSlug)}` : null
}

export class SearchCatalog extends Query.Service<SearchCatalog>()('search/SearchCatalog', {
  args: { query: Schema.String, generation: Schema.Number, queryScope: SearchQueryScope },
  success: SearchResults,
  error: Schema.String,
  staleTime: 0,
  idleTimeToLive: 0,
}) {
  static readonly layer = this.toLayer(({ query, queryScope }) =>
    Effect.gen(function* () {
      if (!queryScope.known) return yield* Effect.fail('Search identity is unavailable')
      const url = new URL('/api/search', queryScope.origin)
      url.searchParams.set('q', query)
      url.searchParams.set('limit', '8')

      const response = yield* Effect.tryPromise({
        try: (signal) => fetch(url, { signal, cache: 'no-store', credentials: 'same-origin' }),
        catch: () => 'Search unavailable',
      })

      if (!response.ok) return yield* Effect.fail('Search unavailable')

      const body = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => 'Search unavailable',
      })

      return yield* Schema.decodeUnknownEffect(SearchResults)(body).pipe(
        Effect.mapError(() => 'Invalid search response'),
      )
    }),
  )
}

export const SearchMessage = UiSchema.TaggedEnum({
  RequestedOpenSearch: {},
  RequestedCloseSearch: {},
  UpdatedSearchQuery: { query: Schema.String },
  SubmittedSearch: {},
  ClosedSearchExternally: {},
  ChangedSearchScope: { queryScope: SearchQueryScope },
  ClickedSearchResult: { href: Schema.String },
})

export const SearchDialogProps = Schema.Struct({
  open: Schema.Boolean,
  showTrigger: Schema.optional(Schema.Boolean),
  queryScope: SearchQueryScope,
})

export const SearchDialogEvents = UiSchema.TaggedEnum({ RequestedOpen: {}, RequestedClose: {} })

export class NavigateSearch extends Command.Service<NavigateSearch>()('NavigateSearch', {
  args: { href: Schema.String, origin: SearchOrigin },
  success: Component.Noop,
}) {
  static readonly layer = this.toLayer(
    Effect.map(
      Router.Router,
      (router) =>
        ({ href, origin }) =>
          Effect.gen(function* () {
            const target = URL.parse(href, origin)

            if (
              !target ||
              !['http:', 'https:'].includes(target.protocol) ||
              target.username ||
              target.password
            )
              return Component.noop

            if (target.origin === origin && isPageUrl(target))
              yield* router.navigate(`${target.pathname}${target.search}${target.hash}`)
            else yield* router.load(target.href)

            return Component.noop
          }),
    ),
  )
}

export const SearchDialogNoDeps = Html.component({
  name: 'SearchDialog',
  props: SearchDialogProps,
  model: Schema.Struct({
    query: Schema.String,
    generation: Schema.Number,
    scopeKey: Schema.String,
  }),
  message: SearchMessage,
  events: SearchDialogEvents,
  restore: false,
  queries: {
    results: {
      query: SearchCatalog,
      debounce: '200 millis',
      args: ({ model, props }) =>
        props.open &&
        props.queryScope.known &&
        model.scopeKey === searchScopeKey(props.queryScope) &&
        model.query.trim()
          ? {
              query: model.query.trim(),
              generation: model.generation,
              queryScope: props.queryScope,
            }
          : undefined,
    },
  },
}).make({
  init: ($) => ({ query: '', generation: 0, scopeKey: searchScopeKey($.props.queryScope) }),
  subscriptions: ({ props }) => [
    HtmlSubscription.shortcuts([
      { key: 'k', mod: true, whileTyping: true, message: SearchMessage.RequestedOpenSearch() },
      { key: '/', message: SearchMessage.RequestedOpenSearch() },
    ]),
    Subscription.make('ObserveSearchScope', searchScopeKey(props.queryScope), () =>
      Stream.succeed(SearchMessage.ChangedSearchScope({ queryScope: props.queryScope })),
    ),
    ...(!props.open
      ? [
          Subscription.make(
            'ObserveClosedSearch',
            Stream.succeed(SearchMessage.ClosedSearchExternally()),
          ),
        ]
      : []),
  ],
  update: {
    ChangedSearchScope: ($, { queryScope }) => {
      const key = searchScopeKey(queryScope)

      if (key !== searchScopeKey($.props.queryScope) || key === $.model.scopeKey) return $.model

      return $.evolve({ query: '', generation: $.model.generation + 1, scopeKey: key }).run(
        Command.interrupt(NavigateSearch),
      )
    },
    RequestedOpenSearch: ($) =>
      $.props.open
        ? $.model
        : $.evolve({ query: '', generation: $.model.generation + 1 }).emit(
            SearchDialogEvents.RequestedOpen(),
          ),
    RequestedCloseSearch: ($) =>
      $.evolve({ query: '', generation: $.model.generation + 1 }).emit(
        SearchDialogEvents.RequestedClose(),
      ),
    ClosedSearchExternally: ($) =>
      $.props.open || !$.model.query
        ? $.model
        : $.evolve({ query: '', generation: $.model.generation + 1 }),
    UpdatedSearchQuery: ($, { query }) =>
      $.props.open &&
      $.props.queryScope.known &&
      $.model.scopeKey === searchScopeKey($.props.queryScope)
        ? $.evolve({ query })
        : $.model,
    ClickedSearchResult: ($, { href }) => {
      if (
        !$.props.open ||
        !$.props.queryScope.known ||
        $.model.scopeKey !== searchScopeKey($.props.queryScope) ||
        !Predicate.isTagged($.queries.results, 'Success')
      )
        return $.model
      const result = $.queries.results.value

      if (
        ![...result.shows, ...result.audio, ...result.posts].some(
          (item) => resultHref(item) === href,
        )
      )
        return $.model

      return $.evolve({ query: '', generation: $.model.generation + 1 })
        .emit(SearchDialogEvents.RequestedClose())
        .run(NavigateSearch.make({ href, origin: $.props.queryScope.origin }))
    },
    SubmittedSearch: ($) => {
      if (
        !$.props.open ||
        !$.props.queryScope.known ||
        $.model.scopeKey !== searchScopeKey($.props.queryScope) ||
        !$.model.query.trim() ||
        !Predicate.isTagged($.queries.results, 'Success')
      )
        return $.model
      const result = $.queries.results.value

      const href = [...result.shows, ...result.audio, ...result.posts]
        .map(resultHref)
        .find((href) => href !== null)

      if (!href) return $.model

      return $.evolve({ query: '', generation: $.model.generation + 1 })
        .emit(SearchDialogEvents.RequestedClose())
        .run(NavigateSearch.make({ href, origin: $.props.queryScope.origin }))
    },
  },
  view: (h, model) =>
    Dialog(h, {
      props: { open: h.props.open, initialFocus: true },
      onEmit: {
        RequestedOpen: () => SearchMessage.RequestedOpenSearch(),
        RequestedClose: () => SearchMessage.RequestedCloseSearch(),
        Settled: () => undefined,
      },
      view: (dialog) =>
        h.div.children(
          h.props.showTrigger
            ? dialog
                .trigger(h.button.attr('type', 'button').attr('aria-label', 'Search'))
                .children('Search')
            : null,
          dialog.portal(h.dialog.class('overlay-dialog'))?.children(
            dialog.backdrop(h.div.class('overlay-backdrop')),
            dialog.viewport(h.div.class('fixed inset-0 grid place-items-start pt-20')).children(
              dialog.popup(h.div.class('search-dialog')).children(
                dialog.title(h.h2.class('sr-only')).children('Search'),
                h.form
                  .attr('role', 'search')
                  .on('submit', SearchMessage.SubmittedSearch(), { preventDefault: true })
                  .children(
                    h.input
                      .attr('id', 'search-query')
                      .attr('type', 'search')
                      .attr('aria-label', 'Search query')
                      .attr('placeholder', 'Search shows, mixes, tweets, editorial…')
                      .value(
                        model.scopeKey === searchScopeKey(h.props.queryScope) ? model.query : '',
                      )
                      .disabled(!h.props.queryScope.known)
                      .on('input', ({ value }) =>
                        SearchMessage.UpdatedSearchQuery({ query: value }),
                      ),
                    dialog
                      .close(h.button.attr('type', 'button').attr('aria-label', 'Close search'))
                      .children('×'),
                  ),
                h.props.queryScope.known &&
                  model.scopeKey === searchScopeKey(h.props.queryScope) &&
                  model.query.trim() &&
                  Predicate.isTagged(h.queries.results, 'Initial')
                  ? h.p.attr('role', 'status').children('Searching…')
                  : null,
                h.props.queryScope.known &&
                  model.scopeKey === searchScopeKey(h.props.queryScope) &&
                  Predicate.isTagged(h.queries.results, 'Failure')
                  ? h.p.attr('role', 'alert').children('Search failed. Try again.')
                  : null,
                h.props.open &&
                  h.props.queryScope.known &&
                  model.scopeKey === searchScopeKey(h.props.queryScope) &&
                  model.query.trim() &&
                  Predicate.isTagged(h.queries.results, 'Success')
                  ? h.div.class('search-results').children(
                      (
                        ['shows', 'audio', 'posts'] satisfies ReadonlyArray<keyof SearchResults>
                      ).map((group) =>
                        h.section.children(
                          h.h2.children(group === 'audio' ? 'Mixes' : group),
                          Predicate.isTagged(h.queries.results, 'Success') &&
                            h.queries.results.value[group].map((item) => {
                              const href = resultHref(item)

                              return href
                                ? h.a
                                    .attr('href', href)
                                    .on(
                                      'click',
                                      (event) =>
                                        event.button === 0 &&
                                        !event.ctrl &&
                                        !event.meta &&
                                        !event.shift &&
                                        !event.alt
                                          ? SearchMessage.ClickedSearchResult({ href })
                                          : undefined,
                                      { preventDefault: true },
                                    )
                                    .children(
                                      item.thumbnailUrl
                                        ? h.img
                                            .attr('src', item.thumbnailUrl)
                                            .attr('alt', '')
                                            .attr('loading', 'lazy')
                                        : null,
                                      h.span.children(item.title || item.slug),
                                    )
                                : null
                            }),
                        ),
                      ),
                      Object.values(h.queries.results.value).every((items) => items.length === 0)
                        ? h.p.children(`No matches for “${model.query.trim()}”`)
                        : null,
                    )
                  : null,
              ),
            ),
          ),
        ),
    }),
})

export const SearchDialog = SearchDialogNoDeps.pipe(
  Component.provide(Layer.merge(SearchCatalog.layer, NavigateSearch.layer)),
)
