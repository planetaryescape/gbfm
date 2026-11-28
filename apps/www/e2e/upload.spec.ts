import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { expect, test, type Page } from '@playwright/test'
import { Schema } from 'effect'

const signIn = async (page: Page) => {
  await page.goto('/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('creator@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.goto('/new/mix')
  await expect(page.getByLabel('Mix audio', { exact: true })).toBeEnabled()
}

test('multipart pause, reload reconciliation and expired URL retry preserve the exact file parts', async ({
  page,
}, testInfo) => {
  const filePath = testInfo.outputPath('resumable-mix.mp3')
  await writeFile(filePath, 'abcdefghijk')
  const received: Array<string> = []
  const presigned: Array<number> = []
  let starts = 0
  let statusReads = 0
  let expired = false
  let completion: unknown
  const firstPart = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const secondPart = Promise.withResolvers<void>()
  const releaseSecond = Promise.withResolvers<void>()

  // Capture real PUT bytes: WebKit's route.request().postDataBuffer() omits Blob bodies.
  const storage = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', '*')
    response.setHeader('Access-Control-Expose-Headers', 'ETag')

    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()

      return
    }

    const chunks: Array<Buffer> = []

    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const part = Number(request.url?.split('/').at(-1))

    if (part === 1) {
      firstPart.resolve()
      await release.promise
    }

    if (part === 2 && !expired) {
      expired = true
      response.writeHead(403).end()

      return
    }

    if (part === 2) {
      secondPart.resolve()
      await releaseSecond.promise
    }

    received.push(Buffer.concat(chunks).toString())
    response.setHeader('ETag', `etag-${part}`)
    response.writeHead(200).end()
  })

  await new Promise<void>((resolve) => storage.listen(0, '127.0.0.1', resolve))

  const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(
    storage.address(),
  )

  try {
    await page.route('**/api/upload/multipart/init', async (route) => {
      starts++
      await route.fulfill({ json: { uploadId: 'upload-1', key: 'audio/mix.mp3', chunkSize: 4 } })
    })
    await page.route('**/api/upload/multipart/status?**', async (route) => {
      statusReads++
      await route.fulfill({
        json: {
          parts: received.map((body, index) => ({
            partNumber: index + 1,
            etag: `etag-${index + 1}`,
            size: body.length,
          })),
        },
      })
    })
    await page.route('**/api/upload/multipart/presign-part', async (route) => {
      const { partNumber } = Schema.decodeUnknownSync(Schema.Struct({ partNumber: Schema.Number }))(
        route.request().postDataJSON(),
      )

      presigned.push(partNumber)
      await route.fulfill({
        json: {
          url: `http://127.0.0.1:${address.port}/parts/${partNumber}`,
          partNumber,
          expiresInSeconds: 900,
        },
      })
    })
    await page.route('**/api/upload/multipart/complete', async (route) => {
      completion = route.request().postDataJSON()
      await route.fulfill({
        json: { url: 'https://cdn.example.test/mix.mp3', key: 'audio/mix.mp3' },
      })
    })

    await signIn(page)
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Resumable upload check')
    await page.getByLabel('Mix audio', { exact: true }).setInputFiles(filePath)
    await firstPart.promise
    await page.getByRole('button', { name: 'Pause upload', exact: true }).click()

    const status = page
      .getByRole('region', { name: 'Audio upload', exact: true })
      .getByRole('status')

    await expect(status).toContainText('Pausing after the current part')
    release.resolve()
    await expect(status).toHaveText('Upload paused · 36%')
    await expect(page.getByRole('progressbar')).toHaveAttribute('value', '36')
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
    await status.scrollIntoViewIfNeeded()
    await testInfo.attach('paused-upload-dark', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.getByRole('button', { name: 'Resume upload', exact: true }).click()
    await secondPart.promise
    await page.getByRole('button', { name: 'Pause upload', exact: true }).click()
    await expect(status).toContainText('Pausing after the current part')
    releaseSecond.resolve()
    await expect(status).toHaveText('Upload paused · 72%')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await testInfo.attach('paused-upload-light', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.reload()
    await expect(page.getByLabel('Mix audio', { exact: true })).toBeEnabled()
    await page.getByLabel('Mix audio', { exact: true }).setInputFiles(filePath)
    await expect(
      page.getByRole('textbox', { name: 'Existing audio URL', exact: true }),
    ).toHaveValue('https://cdn.example.test/mix.mp3')
    expect(starts).toBe(1)
    expect(statusReads).toBe(2)
    expect(presigned).toEqual([1, 2, 2, 3])
    expect(received).toEqual(['abcd', 'efgh', 'ijk'])
    expect(completion).toEqual({
      key: 'audio/mix.mp3',
      uploadId: 'upload-1',
      parts: [
        { partNumber: 1, etag: 'etag-1' },
        { partNumber: 2, etag: 'etag-2' },
        { partNumber: 3, etag: 'etag-3' },
      ],
    })
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((key) => key.startsWith('gbfm:resumable-upload:')),
      ),
    ).toEqual([])
  } finally {
    release.resolve()
    releaseSecond.resolve()
    storage.closeAllConnections()
    await new Promise<void>((resolve) => storage.close(() => resolve()))
  }
})

test('malformed init is a recoverable upload failure rather than a stuck command', async ({
  page,
}) => {
  await page.route('**/api/upload/multipart/init', (route) =>
    route.fulfill({ json: { uploadId: 'bad', key: 'bad', chunkSize: 0 } }),
  )
  await signIn(page)
  await page
    .getByLabel('Mix audio', { exact: true })
    .setInputFiles({ name: 'bad.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('audio') })
  await expect(page.locator('.form-error')).toHaveText('init: invalid response')
  await expect(page.getByRole('button', { name: 'Resume upload', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Cancel upload', exact: true }).click()
  await expect(page.getByLabel('Mix audio', { exact: true })).toBeEnabled()
})

test('failed remote cancellation retains the checkpoint until retry succeeds', async ({
  page,
}, testInfo) => {
  let aborts = 0
  await page.route('**/api/upload/multipart/init', (route) =>
    route.fulfill({ json: { uploadId: 'cancel-test', key: 'audio/cancel.mp3', chunkSize: 4 } }),
  )
  await page.route('**/api/upload/multipart/presign-part', (route) =>
    route.fulfill({ status: 400 }),
  )
  await page.route('**/api/upload/multipart/abort', async (route) => {
    aborts++
    await route.fulfill(aborts === 1 ? { status: 400 } : { json: { ok: true } })
  })
  await signIn(page)
  await page
    .getByLabel('Mix audio', { exact: true })
    .setInputFiles({ name: 'cancel.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('abcdef') })
  const status = page.getByRole('region', { name: 'Audio upload', exact: true }).getByRole('status')
  await expect(status).toHaveText('Upload failed · 0%')
  await page.getByRole('button', { name: 'Cancel upload', exact: true }).click()
  await expect(status).toHaveText('Upload failed · 0%')
  expect(aborts).toBe(1)
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('gbfm:resumable-upload:')),
    ),
  ).toHaveLength(1)
  await status.scrollIntoViewIfNeeded()
  await testInfo.attach('upload-cancel-failed', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  await page.getByRole('button', { name: 'Cancel upload', exact: true }).click()
  await expect(page.getByLabel('Mix audio', { exact: true })).toBeEnabled()
  expect(aborts).toBe(2)
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('gbfm:resumable-upload:')),
    ),
  ).toEqual([])
})
