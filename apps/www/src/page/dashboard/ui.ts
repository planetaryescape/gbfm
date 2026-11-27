import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { absoluteTime, relativeTimeLabel } from '../../features/dashboard/formatting'

export {
  absoluteTime,
  activeDatePreset,
  datePresets,
  daysAgoDate,
  filterHref,
  pageRange,
  plural,
  relativeTimeLabel,
} from '../../features/dashboard/formatting'

type Child = Html | string

export type Tone = 'ok' | 'warn' | 'error' | 'neutral'

export const badge = <M>(h: HtmlBuilder<M>, label: string, tone: Tone, title?: string) =>
  h.span(
    [h.Class('admin-badge'), h.DataAttribute('tone', tone), ...(title ? [h.Title(title)] : [])],
    [label],
  )

export const relativeTime = <M>(h: HtmlBuilder<M>, iso: string, now = Date.now()) =>
  h.time([h.Datetime(iso), h.Title(absoluteTime(iso))], [relativeTimeLabel(iso, now)])

export const pageHeader = <M>(
  h: HtmlBuilder<M>,
  description: string,
  actions: ReadonlyArray<Child> = [],
) =>
  h.div(
    [h.Class('admin-header')],
    [
      h.p([h.Class('admin-description')], [description]),
      actions.length ? h.div([h.Class('admin-header-actions')], actions) : h.empty,
    ],
  )

export const frame = <M>(h: HtmlBuilder<M>, children: ReadonlyArray<Child>) =>
  h.div([h.Class('admin-frame')], children)

export const toolbar = <M>(h: HtmlBuilder<M>, children: ReadonlyArray<Child>) =>
  h.div([h.Class('admin-toolbar')], children)

export type SegmentItem<M> =
  | { readonly label: string; readonly active: boolean; readonly href: string }
  | { readonly label: string; readonly active: boolean; readonly onClick: M }

export const segmented = <M>(
  h: HtmlBuilder<M>,
  label: string,
  items: ReadonlyArray<SegmentItem<M>>,
) =>
  h.div(
    [h.Class('admin-segmented'), h.Role('group'), h.AriaLabel(label)],
    items.map((item) =>
      'href' in item
        ? h.a([h.Href(item.href), ...(item.active ? [h.AriaCurrent('true')] : [])], [item.label])
        : h.button(
            [h.Type('button'), h.AriaPressed(String(item.active)), h.OnClick(item.onClick)],
            [item.label],
          ),
    ),
  )

export interface Column {
  readonly label: string
  readonly className?: string
  readonly width?: string
}

export interface TableRow<M> {
  readonly key: string
  readonly cells: ReadonlyArray<Child>
  readonly attributes?: ReadonlyArray<Attribute<M>>
  readonly detail?: Child
}

const cellClass = <M>(h: HtmlBuilder<M>, column: Column | undefined) =>
  column?.className ? [h.Class(column.className)] : []

export const dataTable = <M>(
  h: HtmlBuilder<M>,
  options: {
    readonly label: string
    readonly columns: ReadonlyArray<Column>
    readonly rows: ReadonlyArray<TableRow<M>>
    readonly loading?: boolean
    readonly minWidth?: string
    readonly empty: Child
  },
) => {
  const { columns } = options

  if (!options.loading && options.rows.length === 0) return options.empty

  const body = options.loading
    ? Array.from({ length: 5 }, (_, index) =>
        h.tr(
          [h.Key(`skeleton-${index}`), h.Class('admin-skeleton'), h.AriaHidden(true)],
          columns.map((column) => h.td(cellClass(h, column), [])),
        ),
      )
    : options.rows.flatMap((row) => [
        h.tr(
          [h.Key(row.key), h.Class('admin-row'), ...(row.attributes ?? [])],
          row.cells.map((cell, index) => h.td(cellClass(h, columns[index]), [cell])),
        ),
        ...(row.detail === undefined || row.detail === null
          ? []
          : [
              h.tr(
                [h.Key(`${row.key}-detail`), h.Class('admin-row-detail')],
                [h.td([h.Colspan(columns.length)], [row.detail])],
              ),
            ]),
      ])

  return h.div(
    [h.Class('admin-table-wrap')],
    [
      h.table(
        [
          h.Class('admin-table'),
          h.AriaLabel(options.label),
          ...(options.minWidth ? [h.Style({ 'min-width': options.minWidth })] : []),
          ...(options.loading ? [h.AriaBusy(true)] : []),
        ],
        [
          h.thead(
            [],
            [
              h.tr(
                [],
                columns.map((column) =>
                  h.th(
                    [
                      h.Scope('col'),
                      ...cellClass(h, column),
                      ...(column.width ? [h.Style({ width: column.width })] : []),
                    ],
                    [column.label],
                  ),
                ),
              ),
            ],
          ),
          h.tbody([], body),
        ],
      ),
    ],
  )
}

export type PagerTarget<M> = { readonly href: string } | { readonly onClick: M }

const pagerControl = <M>(h: HtmlBuilder<M>, label: string, target: PagerTarget<M> | null) =>
  target === null
    ? h.span([h.Class('admin-pager-control'), h.AriaDisabled(true)], [label])
    : 'href' in target
      ? h.a([h.Class('admin-pager-control'), h.Href(target.href)], [label])
      : h.button(
          [h.Class('admin-pager-control'), h.Type('button'), h.OnClick(target.onClick)],
          [label],
        )

export const pager = <M>(
  h: HtmlBuilder<M>,
  options: {
    readonly label: string
    readonly summary: string
    readonly previous: PagerTarget<M> | null
    readonly next: PagerTarget<M> | null
  },
) => {
  const summary = h.span([h.Class('admin-pager-summary')], [options.summary])

  if (!options.previous && !options.next) return h.div([h.Class('admin-pager')], [summary])

  return h.nav(
    [h.Class('admin-pager'), h.AriaLabel(options.label)],
    [
      summary,
      h.div(
        [h.Class('admin-pager-controls')],
        [pagerControl(h, 'Previous', options.previous), pagerControl(h, 'Next', options.next)],
      ),
    ],
  )
}

export const emptyState = <M>(
  h: HtmlBuilder<M>,
  message: string,
  clear?: { readonly href: string } | { readonly onClick: M },
) =>
  h.div(
    [h.Class('admin-empty')],
    [
      h.p([], [message]),
      clear === undefined
        ? h.empty
        : 'href' in clear
          ? h.a([h.Href(clear.href)], ['Clear filters'])
          : h.button(
              [h.Type('button'), h.Class('dashboard-button-quiet'), h.OnClick(clear.onClick)],
              ['Clear filters'],
            ),
    ],
  )

export const drawer = <M>(
  h: HtmlBuilder<M>,
  summary: string,
  children: ReadonlyArray<Child>,
  primary = true,
) =>
  h.details(
    [h.Class(primary ? 'admin-drawer' : 'admin-drawer admin-drawer-secondary')],
    [h.summary([], [summary]), h.div([h.Class('admin-drawer-body')], children)],
  )
