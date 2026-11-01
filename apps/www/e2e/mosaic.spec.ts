import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { expect, test, type Page } from '@playwright/test'
import { Schema } from 'effect'

import type { SocialCardRenderAssets } from '../../social-image/src/render-runtime'
import { renderMosaicFixture } from '../../social-image/test/mosaic-fixture'

const signIn = async (page: Page) => {
  await page.goto('/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('creator@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.goto('/new/editorial')
}

test('generate, preview, accept, save, reload and regenerate artwork without changing it on content edits', async ({
  page,
}, testInfo) => {
  const assets: SocialCardRenderAssets = {
    loadWasm: async (name) =>
      new Uint8Array(await readFile(new URL(`../../social-image/assets/${name}`, import.meta.url)))
        .buffer,
    loadFont: async () => new ArrayBuffer(0),
    loadImage: async () => null,
  }

  const result = await renderMosaicFixture(assets)

  if (!result) throw new Error('Expected fixture mosaic')
  let uploads = 0
  const stored = new Map<string, Buffer>()

  const storage = createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-methods', 'PUT, GET, OPTIONS')
    response.setHeader('access-control-allow-headers', '*')

    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()

      return
    }

    if (request.method === 'PUT') {
      const chunks: Array<Buffer> = []

      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      stored.set(request.url ?? '', Buffer.concat(chunks))
      response.writeHead(200).end()

      return
    }

    response.setHeader('content-type', 'image/png')
    response.end(stored.get(request.url ?? ''))
  })

  await new Promise<void>((resolve) => storage.listen(0, '127.0.0.1', resolve))

  const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(
    storage.address(),
  )

  const origin = `http://127.0.0.1:${address.port}`

  try {
    await page.route('**/actions/mosaic', async (route) =>
      route.fulfill({
        body: Buffer.from(result.png),
        headers: {
          'content-type': 'image/png',
          'x-mosaic-revision': result.revision,
          'cache-control': 'no-store',
        },
      }),
    )
    await page.route('**/api/upload/image/presign', async (route) => {
      uploads++
      await route.fulfill({
        json: {
          uploadUrl: `${origin}/mosaic-${uploads}.png`,
          publicUrl: `${origin}/mosaic-${uploads}.png`,
          key: `fixture/mosaic-${uploads}.png`,
        },
      })
    })
    await signIn(page)
    const slug = `mosaic-e2e-${crypto.randomUUID()}`
    await page
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill('Four records for a quiet evening')
    const canvas = page.getByRole('textbox', { name: 'Writing canvas' })
    await canvas.fill('A selection of four records.\n\n![Cover](https://i.scdn.co/image/fixture)')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('textbox', { name: 'Story URL', exact: true }).fill(slug)
    const artwork = page.getByRole('textbox', { name: 'Artwork URL', exact: true })
    await artwork.fill('https://i.scdn.co/image/original')
    await page.getByRole('button', { name: 'Generate mosaic', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Use mosaic', exact: true })).toBeVisible()
    await expect(artwork).toHaveValue('https://i.scdn.co/image/original')
    const preview = page.getByRole('img', { name: 'Generated mosaic preview' })
    await expect(preview).toBeVisible()

    for (const viewport of [
      { name: 'mobile', width: 390, height: 844 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'desktop', width: 1280, height: 800 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await preview.scrollIntoViewIfNeeded()
      await expect(page.getByRole('button', { name: 'Use mosaic', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      const name = `mosaic-preview-${viewport.name}-${viewport.width}x${viewport.height}`
      await testInfo.attach(name, {
        body: await page.screenshot({ path: testInfo.outputPath(`${name}.png`) }),
        contentType: 'image/png',
      })
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await preview.scrollIntoViewIfNeeded()
    await testInfo.attach('mosaic-preview-light', {
      body: await page.screenshot({ path: testInfo.outputPath('mosaic-preview-light.png') }),
      contentType: 'image/png',
    })
    await page.getByRole('button', { name: 'Use mosaic', exact: true }).click()
    await expect(artwork).toHaveValue(`${origin}/mosaic-1.png`)
    await page.getByRole('button', { name: 'Close publish review', exact: true }).click()
    await canvas.fill('Edited post. The saved artwork stays unchanged.')

    const savedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/content/post') && response.request().method() === 'POST',
    )

    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    expect((await savedResponse).ok()).toBe(true)
    await expect(page.getByRole('link', { name: '← Back to post' })).toBeVisible()
    const saved = await page.request.get(`/api/content/posts/${slug}/edit`)
    expect(saved.ok()).toBe(true)

    const post = Schema.decodeUnknownSync(
      Schema.Struct({ thumbnailUrl: Schema.String, draft: Schema.Boolean }),
    )(await saved.json())

    expect(post).toEqual({ thumbnailUrl: `${origin}/mosaic-1.png`, draft: true })
    await page.goto(`/new/editorial?edit=${slug}`)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(artwork).toHaveValue(`${origin}/mosaic-1.png`)
    await page.getByRole('button', { name: 'Regenerate mosaic', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Use mosaic', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Keep existing artwork', exact: true }).click()
    await expect(artwork).toHaveValue(`${origin}/mosaic-1.png`)
    expect(uploads).toBe(2)
    expect(stored.get('/mosaic-1.png')).toEqual(Buffer.from(result.png))
    await page.route('**/actions/mosaic', async (route) =>
      route.fulfill({ status: 422, body: 'No usable images found.' }),
    )
    await page.getByRole('button', { name: 'Regenerate mosaic', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('No usable images found')
    await expect(artwork).toHaveValue(`${origin}/mosaic-1.png`)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally {
    await new Promise<void>((resolve, reject) =>
      storage.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('the actual generation endpoint denies anonymous requests', async ({ request, baseURL }) => {
  const response = await request.post('/actions/mosaic', {
    headers: { origin: baseURL ?? 'http://127.0.0.1:5173' },
    data: { content: '![Cover](https://i.scdn.co/image/fixture)' },
  })

  expect([401, 403]).toContain(response.status())
})
