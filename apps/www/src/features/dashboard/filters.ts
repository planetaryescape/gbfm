import { filterHref } from './formatting'

export const dateFilterHref = (href: string, dateFrom: string | null) => {
  const url = new URL(href, 'http://localhost')

  return filterHref(url.pathname, url.searchParams, { dateFrom, dateTo: null })
}
