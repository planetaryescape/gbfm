import type { MicroPostTimelineMonth } from '@gbfm/api/navigation'

export type RailMonth = Omit<MicroPostTimelineMonth, 'newestSlug'> & {
  readonly newestSlug: string | null
}

const monthKey = (year: number, monthIndex: number) =>
  `${year}-${String(monthIndex + 1).padStart(2, '0')}`

const parseMonth = (month: string) => {
  const [year = 0, monthNumber = 1] = month.split('-').map(Number)

  return { year, monthIndex: monthNumber - 1 }
}

export const timelineMonths = (timeline: ReadonlyArray<RailMonth>): ReadonlyArray<RailMonth> => {
  const first = timeline[0]
  const last = timeline.at(-1)

  if (!first || !last) return []
  const byMonth = new Map(timeline.map((entry) => [entry.month, entry]))
  const start = parseMonth(first.month)
  const end = parseMonth(last.month)
  const months: Array<RailMonth> = []

  for (
    let cursor = end.year * 12 + end.monthIndex;
    cursor >= start.year * 12 + start.monthIndex;
    cursor -= 1
  ) {
    const month = monthKey(Math.floor(cursor / 12), cursor % 12)
    months.push(byMonth.get(month) ?? { month, total: 0, unread: 0, newestSlug: null })
  }

  return months
}

export const monthLabel = (month: string) => {
  const { year, monthIndex } = parseMonth(month)

  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export const monthOf = (at: string) => {
  const date = new Date(at)

  return monthKey(date.getUTCFullYear(), date.getUTCMonth())
}

export const relativeAge = (at: string, now: number) => {
  const days = Math.floor((now - new Date(at).getTime()) / (24 * 60 * 60 * 1000))
  const format = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })

  if (days < 1) return 'today'

  if (days < 30) return format.format(-days, 'day')

  if (days < 365) return format.format(-Math.floor(days / 30), 'month')

  return format.format(-Math.floor(days / 365), 'year')
}
