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

const start = async (page: Page) => {
  const envelopes: Array<string> = []
  const html = await readFile(new URL('./observability.html', import.meta.url), 'utf8')
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
