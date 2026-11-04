import { AudioResponse } from '@gbfm/api/audio'
import { CompiledPostResponse, PostResponse } from '@gbfm/api/post'
import { expect, test, type Page } from '@playwright/test'
import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'

const signIn = async (page: Page, email = 'admin@gbfm.local') => {
  await page.goto('/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  const session = await page.request.get('/auth/get-session')

  const identity = Schema.decodeUnknownSync(
    Schema.Struct({ user: Schema.Struct({ id: Schema.String, name: Schema.String }) }),
  )(await session.json())

  const fixture = await page.request.get('/api/content/audio/mix/e2e-local-frequencies')
  const mix = Schema.decodeUnknownSync(AudioResponse)(await fixture.json())
  const creatorIds = [identity.user.id, ...(mix.creators ?? []).map(({ id }) => id)]
  expect(creatorIds).toHaveLength(2)

  return {
    creatorIds,
    creatorNames: [identity.user.name, ...(mix.creators ?? []).map(({ name }) => name)],
    audioUrl: mix.url,
    showId: mix.showId,
  }
}

test('source diagnostics update after editing and restoring a local draft', async ({ page }) => {
  await signIn(page)
  await page.goto('/new/editorial')
  const canvas = page.getByRole('textbox', { name: 'Writing canvas' })
  const diagnostics = page.getByRole('list', { name: 'Source diagnostics' })
  await canvas.fill('<div>Unsupported markup</div>')
  await expect(diagnostics).toContainText('Raw HTML is unsupported')
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved locally' })).toBeVisible()
  await page.reload()
  await expect(canvas).toHaveValue('<div>Unsupported markup</div>')
  await expect(diagnostics).toContainText('Raw HTML is unsupported')
  await canvas.fill('Ordinary **Markdown**')
  await expect(diagnostics).toHaveCount(0)
})

test('remote draft save retains edits made while its response is pending', async ({
  page,
}, testInfo) => {
  await signIn(page)
  await page.goto('/new/editorial')
  const canvas = page.getByRole('textbox', { name: 'Writing canvas', exact: true })
  const original = `Original fixture ${crypto.randomUUID()}`
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(original)
  await canvas.fill(original)
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved locally' })).toBeVisible()
  const accepted = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let requests = 0
  await page.route('**/api/content/post', async (route) => {
    requests += 1
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    accepted.resolve()
    await release.promise
    await route.fulfill({ response })
  })

  try {
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await accepted.promise
    await expect(page.getByRole('status').filter({ hasText: 'Saving…' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
    await canvas.fill('Newer unsaved fixture content')
    release.resolve()
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible()
    await expect(canvas).toHaveValue('Newer unsaved fixture content')
    expect(requests).toBe(1)
    await expect
      .poll(async () => {
        const value = await page.evaluate(() => localStorage.getItem('gbfm:creator:post:new'))

        return value === null
          ? null
          : Schema.decodeUnknownSync(
              Schema.fromJsonString(
                Schema.Struct({
                  content: Schema.String,
                  editSlug: Schema.NullOr(Schema.String),
                  postId: Schema.optional(Schema.String),
                }),
              ),
            )(value)
      })
      .toMatchObject({
        content: 'Newer unsaved fixture content',
        editSlug: expect.stringMatching(/\S/),
        postId: expect.stringMatching(/\S/),
      })
    const retained = await page.evaluate(() => localStorage.getItem('gbfm:creator:post:new'))

    const draft = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({ content: Schema.String, editSlug: Schema.String, postId: Schema.String }),
      ),
    )(retained)

    expect(draft.content).toBe('Newer unsaved fixture content')
    expect(draft.editSlug).not.toBe('')
    expect(draft.postId).not.toBe('')
    await testInfo.attach('creator-newer-edits-retained', {
      body: await page.screenshot({
        path: testInfo.outputPath('creator-newer-edits-retained.png'),
      }),
      contentType: 'image/png',
    })
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('gbfm:creator:post:new')))
      .toBeNull()
  } finally {
    release.resolve()
  }
})

test('a creator resolves a saved draft from the dashboard without saving other edits or publishing', async ({
  page,
}, testInfo) => {
  await signIn(page, 'creator@gbfm.local')
  const slug = `e2e-manual-resolution-${crypto.randomUUID()}`
  const content = 'Listening: https://open.spotify.com/track/2Mf7lfHxdiABiO7j0BDbHc'

  const created = await page.request.post('/api/content/post', {
    data: { type: 'micro', title: 'Resolve my saved draft', content, slug, draft: true },
  })

  expect(created.ok()).toBe(true)
  const post = Schema.decodeUnknownSync(PostResponse)(await created.json())
  await page.goto('/dashboard/content/tweets')
  await page.locator(`a[href="/new/tweet?edit=${slug}"]`).click()
  await expect(
    page.getByRole('button', { name: 'Resolve saved post music', exact: true }),
  ).toBeVisible()
  await testInfo.attach('post-music-idle', {
    body: await page.screenshot({ path: testInfo.outputPath('post-music-idle.png') }),
    contentType: 'image/png',
  })
  const canvas = page.getByRole('textbox', { name: 'Writing canvas', exact: true })
  await canvas.fill('An unsaved edit must stay in the editor.')
  const endpoint = `**/api/content/posts/${post.id}/resolve-music-entity`
  await page.route(endpoint, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700))
    await route.continue()
  })
  await page.getByRole('button', { name: 'Resolve saved post music', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resolving music…', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Music URL', exact: true })).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Attach & save music', exact: true }),
  ).toBeDisabled()
  await testInfo.attach('post-music-pending', {
    body: await page.screenshot({ path: testInfo.outputPath('post-music-pending.png') }),
    contentType: 'image/png',
  })
  await expect(
    page.getByRole('status').filter({ hasText: 'Music attachment saved.' }),
  ).toBeVisible()
  await expect(page.locator('.creator-music-card')).toContainText('Grapefruit')
  await expect(canvas).toHaveValue('An unsaved edit must stay in the editor.')
  await expect(page.getByRole('region', { name: 'Previous music references' })).toBeVisible()
  await testInfo.attach('post-music-success', {
    body: await page.screenshot({ path: testInfo.outputPath('post-music-success.png') }),
    contentType: 'image/png',
  })

  const saved = Schema.decodeUnknownSync(CompiledPostResponse)(
    await (await page.request.get(`/api/content/posts/${slug}/edit`)).json(),
  )

  expect(saved).toMatchObject({
    content,
    draft: true,
    musicEntityId: '00000000-0000-4000-8000-000000000003',
    musicEntityType: 'track',
  })
  await page.reload()
  await expect(page.locator('.creator-music-card')).toContainText('Attached music')
  await expect(canvas).toHaveValue(content)
  await page.getByRole('button', { name: 'Re-resolve saved post music', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Music attachment saved.' }),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Update', exact: true }).click()
  await expect(page.locator('.creator-published')).toContainText('Published.')

  const resolvedAfterPublication = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/posts/${post.id}/resolve-music-entity`) &&
      response.request().method() === 'POST',
  )

  await page.getByRole('button', { name: 'Re-resolve saved post music', exact: true }).click()
  expect((await resolvedAfterPublication).status()).toBe(200)
})

test('saved-post resolution explains missing links and provider retry delays, then allows retry', async ({
  page,
}, testInfo) => {
  await signIn(page, 'creator@gbfm.local')
  const slug = `e2e-resolution-errors-${crypto.randomUUID()}`

  const created = await page.request.post('/api/content/post', {
    data: {
      type: 'post',
      title: 'A draft without a music link',
      content: 'Listening notes.',
      slug,
      draft: true,
    },
  })

  expect(created.ok()).toBe(true)
  const post = Schema.decodeUnknownSync(PostResponse)(await created.json())
  await page.goto(`/new/editorial?edit=${slug}`)
  const resolve = page.getByRole('button', { name: 'Resolve saved post music', exact: true })
  await resolve.click()
  await expect(page.getByRole('alert')).toContainText('No music link found in the saved post.')
  await expect(resolve).toBeEnabled()
  await testInfo.attach('post-music-no-link', {
    body: await page.screenshot({ path: testInfo.outputPath('post-music-no-link.png') }),
    contentType: 'image/png',
  })
  const url = 'https://open.spotify.com/track/2Mf7lfHxdiABiO7j0BDbHc'
  await page.getByRole('textbox', { name: 'Music URL', exact: true }).fill(url)
  const endpoint = `**/api/content/posts/${post.id}/resolve-music-entity`
  await page.route(endpoint, (route) =>
    route.fulfill({
      status: 503,
      headers: { 'retry-after': '30' },
      json: new HttpApiError.ServiceUnavailable(),
    }),
  )
  await page.getByRole('button', { name: 'Attach & save music', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'Music providers are busy or temporarily unavailable. Try again in 30 seconds.',
  )
  await expect(resolve).toBeEnabled()
  await expect(page.getByRole('textbox', { name: 'Music URL', exact: true })).toHaveValue(url)
  await testInfo.attach('post-music-provider-busy', {
    body: await page.screenshot({ path: testInfo.outputPath('post-music-provider-busy.png') }),
    contentType: 'image/png',
  })
  await page.unroute(endpoint)
  await page.getByRole('button', { name: 'Attach & save music', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Music attachment saved.' }),
  ).toBeVisible()
  expect(
    Schema.decodeUnknownSync(CompiledPostResponse)(
      await (await page.request.get(`/api/content/posts/${slug}/edit`)).json(),
    ),
  ).toMatchObject({ draft: true, content: 'Listening notes.', musicEntityType: 'track' })
  await page.goto('/new/tweet')
  await expect(
    page.getByRole('button', { name: 'Resolve saved post music', exact: true }),
  ).toHaveCount(0)
  await page.goto('/new/mix?edit=e2e-local-frequencies')
  await expect(page.getByRole('region', { name: 'Saved post music', exact: true })).toHaveCount(0)
})

test('author selection supports keyboard search, removal, retry and saved identity', async ({
  page,
}) => {
  const { creatorIds } = await signIn(page)
  const slug = `e2e-authors-${Date.now()}`
  await page.goto('/new/tweet')
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Collaborative listening')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  const authors = page.getByRole('list', { name: 'Authors', exact: true })
  await expect(authors).toContainText('Local Admin')
  await expect(authors.getByRole('button', { name: 'Remove' })).toBeDisabled()
  await page.getByText('Add authors', { exact: true }).press('Enter')
  const query = page.getByRole('textbox', { name: 'Search authors', exact: true })
  await query.fill('no-such-author')
  await expect(page.getByRole('button', { name: 'Search authors', exact: true })).toBeEnabled()
  await query.press('Enter')
  await expect(page.getByText('No authors found. Try another name or username.')).toBeVisible()
  await page.route('**/api/user/search?*', (route) => route.fulfill({ status: 403 }))
  await query.fill('Local Creator')
  await page.getByRole('button', { name: 'Search authors', exact: true }).click()
  await expect(page.getByText('Could not search authors.', { exact: false })).toBeVisible()
  await page.unroute('**/api/user/search?*')
  await page.getByRole('button', { name: 'Search authors', exact: true }).click()
  const result = page.getByRole('button', { name: 'Local Creator · @local-creator', exact: true })
  await result.press('Enter')
  await expect(result).toHaveCount(0)

  const selectedResult = page.getByRole('button', {
    name: 'Local Creator · @local-creator — Selected',
    exact: true,
  })

  await expect(selectedResult).toBeDisabled()
  await authors
    .getByRole('listitem')
    .filter({ hasText: 'Local Creator' })
    .getByRole('button', { name: 'Remove' })
    .click()
  await expect(authors).not.toContainText('Local Creator')
  await result.click()
  await page.getByRole('textbox', { name: 'Story URL', exact: true }).fill(slug)
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.locator('.creator-published')).toContainText('Published.')

  const post = Schema.decodeUnknownSync(CompiledPostResponse)(
    await (await page.request.get(`/api/content/posts/${slug}/edit`)).json(),
  )

  expect(post.creators?.map(({ id }) => id).sort()).toEqual([...creatorIds].sort())
  await page.goto(`/new/tweet?edit=${slug}`)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(authors).toContainText('Local Creator')
  await expect(authors).not.toContainText('Author name unavailable')
  await authors
    .getByRole('listitem')
    .filter({ hasText: 'Local Creator' })
    .getByRole('button', { name: 'Remove' })
    .click()
  await page.getByRole('button', { name: 'Update', exact: true }).click()
  await expect(page.locator('.creator-published')).toContainText('Published.')

  const edited = Schema.decodeUnknownSync(CompiledPostResponse)(
    await (await page.request.get(`/api/content/posts/${slug}/edit`)).json(),
  )

  expect(edited.creators?.map(({ id }) => id)).toEqual(creatorIds.slice(0, 1))
})

test('mix creation satisfies the API contract and editing preserves audio and co-creators', async ({
  page,
}) => {
  const { creatorIds, creatorNames, audioUrl, showId } = await signIn(page)
  const slug = `e2e-composer-mix-${Date.now()}`
  await page.goto('/new/mix')
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('A newly published mix')
  await page.getByRole('textbox', { name: 'Existing audio URL', exact: true }).fill(audioUrl)
  await page.getByRole('textbox', { name: 'Show ID', exact: true }).fill(showId ?? '')
  await page.getByRole('spinbutton', { name: 'Episode number', exact: true }).fill('7')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('textbox', { name: 'Story URL', exact: true }).fill(slug)
  await page.getByText('Add authors', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Search authors', exact: true }).fill('Local Creator')
  await page.getByRole('button', { name: 'Search authors', exact: true }).click()
  await page.getByRole('button', { name: 'Local Creator · @local-creator', exact: true }).click()
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.locator('.creator-published')).toContainText('Published.')
  await page.goto(`/new/mix?edit=${slug}`)
  await expect(page.getByRole('textbox', { name: 'Existing audio URL', exact: true })).toHaveValue(
    audioUrl,
  )
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(
    page.getByRole('list', { name: 'Authors', exact: true }).getByRole('listitem'),
  ).toHaveCount(creatorNames.length)

  for (const name of creatorNames)
    await expect(page.getByRole('list', { name: 'Authors', exact: true })).toContainText(name ?? '')
  await expect(page.getByRole('textbox', { name: 'Author IDs', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Tweet', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Edited mix with both creators')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Update', exact: true }).click()
  await expect(page.locator('.creator-published')).toContainText('Published.')
  const response = await page.request.get(`/api/content/audio/mix/${slug}`)
  const mix = Schema.decodeUnknownSync(AudioResponse)(await response.json())
  expect(mix.title).toBe('Edited mix with both creators')
  expect(mix.url).toBe(audioUrl)
  expect(mix.showId).toBe(showId)
  expect(mix.episodeNumber).toBe(7)
  expect(mix.creators?.map(({ id }) => id).sort()).toEqual([...creatorIds].sort())
})

test('editorial editing with empty artwork preserves co-creators and saved content', async ({
  page,
}) => {
  const { creatorIds } = await signIn(page)
  const slug = `e2e-composer-editorial-${Date.now()}`

  const created = await page.request.post('/api/content/post', {
    data: {
      type: 'post',
      slug,
      title: 'Original editorial',
      content: 'Original body',
      draft: false,
      creatorIds,
    },
  })

  expect(created.ok()).toBe(true)
  await page.goto(`/new/editorial?edit=${slug}`)
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
    'Original editorial',
  )
  await page.getByRole('textbox', { name: 'Writing canvas' }).fill('The revised editorial body.')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Update', exact: true }).click()
  await expect(page.locator('.creator-published')).toContainText('Published.')
  const response = await page.request.get(`/api/content/posts/${slug}/edit`)
  const post = Schema.decodeUnknownSync(CompiledPostResponse)(await response.json())
  expect(post.content).toBe('The revised editorial body.')
  expect(post.creators?.map(({ id }) => id).sort()).toEqual([...creatorIds].sort())
})

test('artwork upload failures are accessible in the open editorial review and can be retried', async ({
  page,
}, testInfo) => {
  await signIn(page)
  await page.route('**/api/upload/image/presign', (route) =>
    route.fulfill({
      json: {
        uploadUrl: 'https://uploads.example.test/editorial.png',
        publicUrl: 'https://cdn.example.test/editorial.png',
        key: 'editorial.png',
      },
    }),
  )
  let uploads = 0
  await page.route('https://uploads.example.test/editorial.png', (route) => {
    uploads++

    return route.fulfill({ status: uploads === 1 ? 503 : 200 })
  })
  await page.goto('/new/editorial')
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Artwork upload check')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Publish post', exact: true })
  const artwork = review.getByLabel('Upload artwork', { exact: true })

  const file = {
    name: 'editorial.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII=',
      'base64',
    ),
  }

  await artwork.setInputFiles(file)
  await expect(review).toBeVisible()
  await expect(review.getByRole('alert')).toHaveText('artwork upload: Artwork upload failed')
  await expect(artwork).toBeEnabled()

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport)
    await review.getByRole('alert').scrollIntoViewIfNeeded()
    await expect(review.getByRole('alert')).toBeInViewport()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true)
    await testInfo.attach(`artwork-error-${viewport.width}x${viewport.height}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  }

  await artwork.setInputFiles(file)
  await expect(review.getByRole('textbox', { name: 'Artwork URL', exact: true })).toHaveValue(
    'https://cdn.example.test/editorial.png',
  )
  await expect(review.getByRole('alert')).toHaveCount(0)
  await expect(review).toBeVisible()
})

test('composer restores metadata, reviews type changes and publishes a quoted tweet with co-creators', async ({
  page,
}, testInfo) => {
  const { creatorIds, creatorNames } = await signIn(page)

  const quoted = Schema.decodeUnknownSync(CompiledPostResponse)(
    await (await page.request.get('/api/content/posts/e2e-music-thread')).json(),
  )

  const slug = `e2e-quote-${Date.now()}`
  await page.goto('/new/tweet')
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('A quoted signal')
  await page
    .getByRole('textbox', { name: 'Writing canvas', exact: true })
    .fill('Listening to **independent radio**.')
  await page
    .getByRole('textbox', { name: 'Quote a tweet', exact: true })
    .fill('https://goosebumps.fm/tweet/e2e-music-thread')
  await page.getByRole('button', { name: 'Attach quote', exact: true }).click()
  await expect(page.getByText('Quoted tweet', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('textbox', { name: 'Story URL', exact: true }).fill(slug)
  await page.getByText('Add authors', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Search authors', exact: true }).fill('Local Creator')
  await page.getByRole('button', { name: 'Search authors', exact: true }).click()
  await page.getByRole('button', { name: 'Local Creator · @local-creator', exact: true }).click()
  const tags = page.getByRole('textbox', { name: 'Tags', exact: true })
  await tags.pressSequentially('radio, community')
  await tags.press('Tab')
  await expect(tags).toHaveValue('radio, community')
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Quote a tweet', exact: true })).toHaveValue(
    'https://goosebumps.fm/tweet/e2e-music-thread',
  )
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(
    page.getByRole('list', { name: 'Authors', exact: true }).getByRole('listitem'),
  ).toHaveText([
    `${creatorNames[0]}Remove`,
    'Author name unavailable — retained from saved draftRemove',
  ])
  await expect(page.getByRole('textbox', { name: 'Tags', exact: true })).toHaveValue(
    'radio, community',
  )
  await expect(page.locator('.creator-review-body')).toContainText('independent radio')
  await page.getByRole('button', { name: 'Editorial', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Editorial', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Tweet', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Tweet', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Publish', exact: true }).scrollIntoViewIfNeeded()
  await testInfo.attach('composer-review-dark', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  await page.emulateMedia({ colorScheme: 'light' })
  await testInfo.attach('composer-review-light', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.locator('.creator-published')).toContainText('Published.')

  const saved = Schema.decodeUnknownSync(CompiledPostResponse)(
    await (await page.request.get(`/api/content/posts/${slug}/edit`)).json(),
  )

  expect(saved.quotedPostId).toBe(quoted.id)
  expect(saved.tags).toEqual(['radio', 'community'])
  expect(saved.creators?.map(({ id }) => id).sort()).toEqual([...creatorIds].sort())
  await page.goto(`/new/tweet?edit=${slug}`)
  await expect(page.getByRole('textbox', { name: 'Quote a tweet', exact: true })).toHaveCount(0)
})

test('music references show published tweets without losing the draft and recover from lookup failure', async ({
  page,
}, testInfo) => {
  await signIn(page)
  const suffix = crypto.randomUUID()
  const entityId = '00000000-0000-4000-8000-000000000001'

  for (const draft of [false, true]) {
    const response = await page.request.post('/api/content/post', {
      data: {
        type: 'micro',
        title: draft ? 'Private listening notes' : 'A late-night favourite',
        slug: `e2e-reference-${draft}-${suffix}`,
        draft,
        musicEntityType: 'track',
        musicEntityId: entityId,
      },
    })

    expect(response.ok()).toBe(true)
  }

  await page.goto('/new/tweet')
  const title = page.getByRole('textbox', { name: 'Title', exact: true })
  await title.fill('A fresh thought about this song')
  await page
    .getByRole('textbox', { name: 'Music URL', exact: true })
    .fill('https://open.spotify.com/track/E2ERootTrack')
  const endpoint = '**/api/content/posts/micro?musicEntityType=*'
  let release: () => void = () => {}

  const pending = new Promise<void>((resolve) => {
    release = resolve
  })

  await page.route(endpoint, async (route) => {
    await pending
    await route.continue()
  })
  await page.getByRole('button', { name: 'Attach music', exact: true }).click()
  const references = page.getByRole('region', { name: 'Previous music references' })
  await expect(references).toContainText('Checking published tweets…')
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled()
  await references.scrollIntoViewIfNeeded()
  await testInfo.attach('references-loading', {
    body: await references.screenshot({ path: testInfo.outputPath('references-loading.png') }),
    contentType: 'image/png',
  })
  release()
  await expect(references).toContainText('A late-night favourite')
  await expect(references).not.toContainText('Private listening notes')
  const earlier = references.locator(`a[href="/tweet/e2e-reference-false-${suffix}"]`)
  await expect(earlier).toHaveAttribute('target', '_blank')
  await expect(references).toContainText('Local Admin')
  await expect(title).toHaveValue('A fresh thought about this song')
  await testInfo.attach('references-found', {
    body: await references.screenshot({ path: testInfo.outputPath('references-found.png') }),
    contentType: 'image/png',
  })
  const popupPromise = page.waitForEvent('popup')
  await earlier.click()
  const popup = await popupPromise
  await expect(popup).toHaveURL(new RegExp(`e2e-reference-false-${suffix}`))
  await popup.close()
  await expect(title).toHaveValue('A fresh thought about this song')
  await page.unroute(endpoint)
  await page.route(endpoint, (route) => route.fulfill({ status: 503, body: '{}' }))
  await page.reload()
  await expect(references).toContainText('Could not check previous tweets')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled()
  await references.scrollIntoViewIfNeeded()
  await testInfo.attach('references-failed', {
    body: await references.screenshot({ path: testInfo.outputPath('references-failed.png') }),
    contentType: 'image/png',
  })
  await page.unroute(endpoint)
  await page.getByRole('button', { name: 'Retry reference check' }).click()
  await expect(references).toContainText('A late-night favourite')
  await page.getByRole('button', { name: 'Remove music', exact: true }).click()
  await expect(references).toHaveCount(0)
  await expect(title).toHaveValue('A fresh thought about this song')
  // The shared fixture suite can publish this track earlier; isolate the empty response state.
  await page.route(endpoint, (route) =>
    route.fulfill({ json: { data: [], pagination: { hasMore: false } } }),
  )
  await page
    .getByRole('textbox', { name: 'Music URL', exact: true })
    .fill('https://open.spotify.com/track/2Mf7lfHxdiABiO7j0BDbHc')
  await page.getByRole('button', { name: 'Attach music', exact: true }).click()
  await expect(references).toContainText('No other published tweets found')
  await references.scrollIntoViewIfNeeded()
  await testInfo.attach('references-empty', {
    body: await references.screenshot({ path: testInfo.outputPath('references-empty.png') }),
    contentType: 'image/png',
  })
})

test('an attached track and an embedded Bandcamp page preview and publish as players', async ({
  page,
}) => {
  const { creatorNames } = await signIn(page)

  const bandcamp =
    'https://babakushi.bandcamp.com/track/the-vigil-of-mashonisa-feat-b-man-lukorito-ntombela-alberto-ranfery-gusto-new-york-zulu-yuba-ushiii'

  const player = 'https://bandcamp.com/EmbeddedPlayer/track=1395951450/'
  const slug = `e2e-bandcamp-${Date.now()}`

  await page.goto('/new/tweet')
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('I really fw this cypher')
  await page
    .getByRole('textbox', { name: 'Music URL', exact: true })
    .fill('https://open.spotify.com/track/E2ERootTrack')
  await page.getByRole('button', { name: 'Attach music', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Attached music' })).toContainText(
    'Root Frequency',
  )

  const media = page.getByRole('textbox', { name: 'Embed media', exact: true })
  await media.fill('https://bandcamp.com')
  await media.press('Enter')
  await expect(media).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('alert')).toContainText('no embeddable player')
  await media.fill(bandcamp)
  await media.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Writing canvas', exact: true })).toHaveValue(
    `::media{url="${bandcamp}"}`,
  )

  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled()
  const preview = page.locator('.creator-preview')
  await expect(preview.locator('iframe').first()).toHaveAttribute('src', new RegExp(`^${player}`))
  await expect(preview).not.toContainText('::media')
  await expect(preview.getByRole('link', { name: 'Open on Bandcamp' })).toHaveAttribute(
    'href',
    bandcamp,
  )

  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  const review = page.locator('.creator-review')
  await expect(review.locator('iframe').first()).toHaveAttribute('src', new RegExp(`^${player}`))
  await expect(review).toContainText('Root Frequency')
  await expect(
    page.getByRole('list', { name: 'Authors', exact: true }).getByRole('listitem'),
  ).toHaveText(creatorNames.slice(0, 1).map((name) => `${name}Remove`))
  await expect(page.getByRole('textbox', { name: 'Author IDs', exact: true })).toBeHidden()
  await page.getByRole('textbox', { name: 'Story URL', exact: true }).fill(slug)
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.locator('.creator-published')).toContainText('Published.')

  await page.goto(`/tweet/${slug}`)
  const embed = page.locator('figure.rich-content-media')
  await expect(embed).toContainText('Bandcamp')
  await expect(embed.locator('iframe').first()).toHaveAttribute('src', new RegExp(`^${player}`))
  await expect(page.getByText('This media embed is unavailable.')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Root Frequency' })).toBeVisible()
})

test('a failed preview hides the previous revision and retries the current source', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/new/tweet')
  const canvas = page.getByRole('textbox', { name: 'Writing canvas', exact: true })
  const preview = page.locator('.creator-preview')
  await canvas.fill('Previous revision')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(preview).toContainText('Previous revision')

  await page.route('**/api/content/posts/preview', (route) => route.abort())
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await canvas.fill('Current **revision**')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(preview.getByRole('alert')).toContainText('The preview could not load')
  await expect(preview).not.toContainText('Previous revision')

  await page.unroute('**/api/content/posts/preview')
  await preview.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(preview).toContainText('Current revision')
  await expect(preview.locator('strong')).toHaveText('revision')
  await expect(preview.getByRole('alert')).toHaveCount(0)
})
