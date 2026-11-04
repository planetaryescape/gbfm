import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

test('the browser adapter delivers bounded signals without changing success or failure results', async ({
  page,
}) => {
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
  await page.getByRole('button', { name: 'Run observability smoke' }).click()
  await expect(page.locator('#result')).toHaveText('{"value":"content-ready","failed":true}')
  await expect.poll(() => envelopes.join('\n')).toContain('NavigationFailed')
  const payload = envelopes.join('\n')
  expect(payload).toContain('gbfm.journey.completed')
  expect(payload).toContain('gbfm.journey.duration')
  expect(payload).not.toContain('synthetic-secret-do-not-export')
})
