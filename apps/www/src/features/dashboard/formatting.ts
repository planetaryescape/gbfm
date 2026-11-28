const MINUTE = 60_000

const HOUR = 60 * MINUTE

const DAY = 24 * HOUR

const zone = 'Africa/Johannesburg'

const absoluteFormat = new Intl.DateTimeFormat('en-ZA', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: zone,
})

const dateFormat = new Intl.DateTimeFormat('en-ZA', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: zone,
})

export const absoluteTime = (iso: string) => {
  const date = new Date(iso)

  return Number.isNaN(date.getTime()) ? iso : absoluteFormat.format(date)
}

export const relativeTimeLabel = (iso: string, now: number) => {
  const time = new Date(iso).getTime()

  if (Number.isNaN(time)) return iso

  const difference = time - now
  const distance = Math.abs(difference)

  if (distance < MINUTE) return 'just now'

  if (distance >= 30 * DAY) return dateFormat.format(new Date(time))

  let amount = `${Math.floor(distance / DAY)}d`

  if (distance < HOUR) amount = `${Math.floor(distance / MINUTE)}m`
  else if (distance < DAY) amount = `${Math.floor(distance / HOUR)}h`

  return difference < 0 ? `${amount} ago` : `in ${amount}`
}

export const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`

export const pageRange = (offset: number, count: number, total: number) =>
  total === 0 || count === 0
    ? 'No results'
    : `${(offset + 1).toLocaleString('en-US')} to ${Math.min(total, offset + count).toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`

export const daysAgoDate = (days: number, now: number) =>
  new Date(now - days * DAY).toISOString().slice(0, 10)

export const filterHref = (
  path: string,
  query: URLSearchParams,
  changes: Readonly<Record<string, string | null>>,
) => {
  const params = new URLSearchParams(query)

  params.delete('offset')

  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }

  const search = params.toString()

  return search ? `${path}?${search}` : path
}

export const datePresets: ReadonlyArray<{ readonly label: string; readonly days: number | null }> =
  [
    { label: '24 hours', days: 1 },
    { label: '7 days', days: 7 },
    { label: '30 days', days: 30 },
    { label: 'All time', days: null },
  ]

export const activeDatePreset = (
  dateFrom: string,
  dateTo: string,
  now: number,
): number | null | 'custom' => {
  if (!dateFrom && !dateTo) return null

  const match = dateTo
    ? undefined
    : datePresets.find(
        (preset) => preset.days !== null && daysAgoDate(preset.days, now) === dateFrom,
      )

  return match?.days ?? 'custom'
}
