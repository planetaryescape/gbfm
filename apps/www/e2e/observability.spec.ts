import { readFile } from 'node:fs/promises'

import { JourneyName, JourneyOutcome } from '@gbfm/observability'
import { expect, test, type Page } from '@playwright/test'
import { Option, Schema } from 'effect'

const completion = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.Literal('transaction'),
      transaction: JourneyName,
      contexts: Schema.Struct({
        trace: Schema.Struct({
          data: Schema.Struct({
            'gbfm.operation': JourneyName,
            'gbfm.outcome': JourneyOutcome,
          }),
        }),
      }),
    }),
  ),
)

const outcomes = (envelopes: ReadonlyArray<string>) =>
  envelopes
    .flatMap((body) => body.split('\n').flatMap((line) => Option.toArray(completion(line))))
    .map((event) => ({
      operation: event.transaction,
      outcome: event.contexts.trace.data['gbfm.outcome'],
    }))

const start = async (page: Page, serverParent?: string) => {
  const envelopes: Array<string> = []
  const source = await readFile(new URL('./observability.html', import.meta.url), 'utf8')
  const html = serverParent
    ? source.replace(
        '</head>',
        `<meta name="sentry-trace" content="${serverParent}"><meta name="baggage" content="sentry-trace_id=${serverParent.slice(0, 32)},sentry-sampled=true"></head>`,
      )
    : source
  await page.route('**/@vite/client', (route) =>
    route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html', body: html })
      : route.continue(),
  )
  await page.route('**/envelope/**', async (route) => {
    envelopes.push(route.request().postData() ?? '')
    await route.fulfill({ status: 200, body: '{}' })
  })
  await page.goto('/@vite/client')

  return envelopes
}

test('the browser adapter delivers bounded signals without changing success or failure results', async ({
  page,
}) => {
  const envelopes = await start(page)
  await page.getByRole('button', { name: 'Run observability smoke' }).click()
  await expect(page.locator('#result')).toHaveText('{"value":"content-ready","failed":true}')
  await expect.poll(() => envelopes.join('\n')).toContain('NavigationFailed')
  const payload = envelopes.join('\n')
  expect(payload).toContain('gbfm.journey.completed')
  expect(payload).toContain('gbfm.journey.duration')
  expect(payload).toContain('"gbfm.outcome":"succeeded"')
  expect(payload).toContain('"gbfm.outcome":"failed"')
  expect(payload).not.toContain('synthetic-secret-do-not-export')
})

test('reader visits follow committed DOM states, replacement, empty results and disposal', async ({
  page,
}) => {
  const envelopes = await start(page)
  await expect(page.locator('#root')).toHaveCount(0)
  await page.getByRole('button', { name: 'Run reader smoke' }).click()
  await expect(page.locator('#result')).toHaveText('Reader outcomes delivered')
  await expect
    .poll(() => outcomes(envelopes))
    .toEqual([
      { operation: 'reader.open', outcome: 'succeeded' },
      { operation: 'reader.open', outcome: 'canceled' },
      { operation: 'reader.open', outcome: 'empty' },
      { operation: 'reader.open', outcome: 'failed' },
      { operation: 'reader.open', outcome: 'canceled' },
    ])
  expect(envelopes.join('\n')).toContain('ReaderOpenFailed')
})

test('playback waits for the real media playing event and records cancellation and rejection', async ({
  page,
}) => {
  const envelopes = await start(page)
  await page.getByRole('button', { name: 'Run playback smoke' }).click()
  await expect(page.locator('#result')).toHaveText('Playback outcomes delivered')
  await expect
    .poll(() => outcomes(envelopes))
    .toEqual([
      { operation: 'playback.start', outcome: 'succeeded' },
      { operation: 'playback.start', outcome: 'canceled' },
      { operation: 'playback.start', outcome: 'failed' },
    ])
  expect(envelopes.join('\n')).toContain('PlaybackStartFailed')
})

test('the browser SDK propagates matching Sentry and W3C parents only to first-party requests', async ({
  page,
}) => {
  const serverTraceId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const serverSpanId = 'bbbbbbbbbbbbbbbb'
  const firstParty: Array<Record<string, string>> = []
  const thirdParty: Array<Record<string, string>> = []
  await page.route('**/api/observability-smoke?*', async (route) => {
    firstParty.push(await route.request().allHeaders())
    await route.fulfill({ status: 200, body: '{}' })
  })
  await page.route('https://third-party.example/**', async (route) => {
    thirdParty.push(await route.request().allHeaders())
    await route.fulfill({
      status: 200,
      body: '{}',
      headers: { 'access-control-allow-origin': '*' },
    })
  })
  const envelopes = await start(page, `${serverTraceId}-${serverSpanId}-1`)
  await page.getByRole('button', { name: 'Run propagation smoke' }).click()
  await expect(page.locator('#result')).toHaveText('Propagation delivered')
  expect(firstParty).toHaveLength(1)
  const sentry = firstParty[0]?.['sentry-trace']
  expect(sentry).toMatch(/^[a-f0-9]{32}-[a-f0-9]{16}-1$/)
  expect(sentry?.slice(0, 32)).toBe(serverTraceId)
  expect(firstParty[0]?.traceparent).toBe(`00-${sentry?.slice(0, 49)}-01`)
  expect(firstParty[0]?.baggage).toContain('sentry-trace_id=')
  expect(thirdParty).toHaveLength(1)
  expect(thirdParty[0]?.['sentry-trace']).toBeUndefined()
  expect(thirdParty[0]?.traceparent).toBeUndefined()
  expect(thirdParty[0]?.baggage).toBeUndefined()
  await expect
    .poll(() => outcomes(envelopes))
    .toEqual([{ operation: 'navigation', outcome: 'succeeded' }])
  expect(JSON.stringify(firstParty)).not.toContain('synthetic-secret-do-not-export')
  expect(envelopes.join('\n')).not.toContain('synthetic-secret-do-not-export')
  await expect.poll(() => envelopes.join('\n')).toContain(`"parent_span_id":"${serverSpanId}"`)
})
