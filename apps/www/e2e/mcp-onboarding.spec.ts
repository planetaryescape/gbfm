import { expect, test, type Page } from '@playwright/test'
import { Match, Schema } from 'effect'

let fixtureClient = 1

test.beforeEach(async ({ context }, info) => {
  const subnet = Match.value(info.project.name).pipe(
    Match.when('desktop', () => 0),
    Match.when('tablet', () => 1),
    Match.orElse(() => 2),
  )

  await context.setExtraHTTPHeaders({ 'cf-connecting-ip': `198.18.${subnet}.${fixtureClient++}` })
  await context.route(
    (url) => !url.hostname.endsWith('.localhost'),
    (route) =>
      route.continue({
        headers: Object.fromEntries(
          Object.entries(route.request().headers()).filter(([name]) => name !== 'cf-connecting-ip'),
        ),
      }),
  )
})

const signIn = async (page: Page, email = 'editor@gbfm.local') => {
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in and continue', exact: true }).click()
}

const consent = (page: Page) =>
  page.getByRole('heading', { name: 'Connect OpenCode?', exact: true })

const otherClientLogo = 'https://assets.example.com/client-logo.svg'

const logoSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#77ddaa"/></svg>'

test('any client can display its supplied logo without leaking the signed continuation', async ({
  page,
}, info) => {
  const imageRequests: Array<Record<string, string>> = []
  await page.route(otherClientLogo, async (route) => {
    imageRequests.push(route.request().headers())
    await route.fulfill({ contentType: 'image/svg+xml', body: logoSvg })
  })
  const document = await page.goto('/api/e2e/mcp-start?other-app=1')
  await expect(
    page.getByRole('heading', { name: 'Connect Another Editor', exact: true }),
  ).toBeVisible()
  await expect(page.locator('[data-client-logo]')).toBeVisible()
  await expect(page.locator('[data-client-initial]')).toBeHidden()
  expect((await document?.allHeaders())?.['content-security-policy']).toContain(
    'img-src https://assets.example.com',
  )
  expect(imageRequests.length).toBeGreaterThan(0)
  expect(imageRequests[0]?.referer).toBeUndefined()
  expect(imageRequests[0]?.authorization).toBeUndefined()
  expect(imageRequests[0]?.cookie).toBeUndefined()
  await signIn(page)
  await expect(
    page.getByRole('heading', { name: 'Connect Another Editor?', exact: true }),
  ).toBeVisible()
  await expect(page.locator('[data-client-logo]')).toBeVisible()
  await expect(page.getByText('not verified by Goosebumps FM', { exact: false })).toBeVisible()

  if (process.env.MCP_EVIDENCE_DIR)
    await page.screenshot({
      path: `${process.env.MCP_EVIDENCE_DIR}/${info.project.name}-generic-client-logo.png`,
      fullPage: true,
    })
  await page.getByRole('button', { name: 'Allow connection', exact: true }).click()
  await expect(
    page.getByText('Connected to local GBFM. Available tools:', { exact: false }),
  ).toBeVisible()
})

test('a failed logo leaves the initial visible and does not block consent', async ({ page }) => {
  await page.route(otherClientLogo, (route) => route.fulfill({ status: 404, body: 'Not found' }))
  await page.goto('/api/e2e/mcp-start?other-app=1')
  await expect(page.locator('[data-client-initial]')).toBeVisible()
  await expect(page.locator('[data-client-initial]')).toHaveText('A')
  await expect(page.locator('[data-client-logo]')).toHaveCount(0)
  await signIn(page)
  await expect(
    page.getByRole('heading', { name: 'Connect Another Editor?', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Allow connection', exact: true })).toBeVisible()
  await expect(page.locator('[data-client-initial]')).toBeVisible()
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })
  test('initials and the full server-driven consent journey still work', async ({ page }) => {
    await page.route(otherClientLogo, (route) =>
      route.fulfill({ contentType: 'image/svg+xml', body: logoSvg }),
    )
    await page.goto('/api/e2e/mcp-start?other-app=1')
    await expect(page.locator('[data-client-initial]')).toBeVisible()
    await expect(page.locator('[data-client-logo]')).toBeHidden()
    await signIn(page)
    await expect(page.getByRole('button', { name: 'Allow connection', exact: true })).toBeVisible()
    await expect(page.locator('[data-client-initial]')).toBeVisible()
    await page.getByRole('button', { name: 'Allow connection', exact: true }).click()
    await expect(
      page.getByText('Connected to local GBFM. Available tools:', { exact: false }),
    ).toBeVisible()
  })
})

test('disabled write permissions explain the policy gate and a reviewed rollout unlocks fresh consent', async ({
  page,
}, info) => {
  const policy = (mode: 'read-only' | 'draft-write') =>
    page.request.post('/api/e2e/mcp-policy', { data: { mode } })

  expect((await policy('read-only')).ok()).toBe(true)

  try {
    await page.goto('/api/e2e/mcp-start?write=1')
    await expect(
      page.getByRole('heading', { name: 'Requested permissions are unavailable', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Not enabled', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Allow connection', exact: true })).toHaveCount(0)
    await expect(
      page.getByText('An operator must enable these permissions before you reconnect.', {
        exact: false,
      }),
    ).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)

    if (process.env.MCP_EVIDENCE_DIR)
      await page.screenshot({
        path: `${process.env.MCP_EVIDENCE_DIR}/${info.project.name}-permissions-unavailable.png`,
        fullPage: true,
      })

    expect((await policy('draft-write')).ok()).toBe(true)
    await page.goto('/api/e2e/mcp-start?write=1')
    await signIn(page)
    await expect(consent(page)).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Read and draft-write access', exact: true }),
    ).toBeVisible()

    if (process.env.MCP_EVIDENCE_DIR)
      await page.screenshot({
        path: `${process.env.MCP_EVIDENCE_DIR}/${info.project.name}-permissions-upgrade-consent.png`,
        fullPage: true,
      })
    await page.getByRole('button', { name: 'Allow connection', exact: true }).click()
    await expect(
      page.getByText('Connected to local GBFM. Available tools:', { exact: false }),
    ).toBeVisible()
    await expect(page.getByText('create_draft', { exact: false })).toBeVisible()
    await expect(page.getByText('update_draft', { exact: false })).toBeVisible()
  } finally {
    expect((await policy('draft-write')).ok()).toBe(true)
  }
})

test('a post first saved from the new-editor URL can recover a conflict in a new tab', async ({
  page,
  context,
}) => {
  await page.goto('/api/e2e/mcp-start')
  await signIn(page)
  await expect(consent(page)).toBeVisible()
  await page.goto('/new/editorial')
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill(`New editorial fixture ${crypto.randomUUID()}`)
  const canvas = page.getByRole('textbox', { name: 'Writing canvas', exact: true })
  await canvas.fill('First browser-created version')

  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/content/post') && response.request().method() === 'POST',
  )

  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  const response = await created
  expect(response.status()).toBe(200)

  const { slug } = Schema.decodeUnknownSync(Schema.Struct({ slug: Schema.String }))(
    await response.json(),
  )

  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible()
  await expect(page).not.toHaveURL(/edit=/)
  await canvas.fill('Keep my local unsaved changes')
  expect(
    (
      await page.request.patch(`/api/content/posts/${slug}`, {
        data: { content: 'Latest remote version' },
      })
    ).ok(),
  ).toBe(true)

  const conflict = page.waitForResponse(
    (reply) =>
      reply.url().endsWith(`/api/content/posts/${slug}`) && reply.request().method() === 'PATCH',
  )

  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  expect((await conflict).status()).toBe(409)
  const opened = context.waitForEvent('page')
  await page.getByRole('link', { name: 'Open latest saved version (new tab)', exact: true }).click()
  const latest = await opened
  const latestCanvas = latest.getByRole('textbox', { name: 'Writing canvas', exact: true })
  await expect(latestCanvas).toHaveValue('Latest remote version')
  await expect(canvas).toHaveValue('Keep my local unsaved changes')
  await latestCanvas.fill('Compared and recovered text')

  const saved = latest.waitForResponse(
    (reply) =>
      reply.url().endsWith(`/api/content/posts/${slug}`) && reply.request().method() === 'PATCH',
  )

  await latest.getByRole('button', { name: 'Save draft', exact: true }).click()
  expect((await saved).status()).toBe(200)
  await latest.close()
})

test('the editorial editor retains local text and reports a stale-save conflict', async ({
  page,
}, info) => {
  await page.goto('/api/e2e/mcp-start')
  await signIn(page)
  await expect(consent(page)).toBeVisible()
  const slug = `editor-conflict-${crypto.randomUUID()}`

  const created = await page.request.post('/api/content/post', {
    data: {
      type: 'post',
      title: 'Concurrent editorial fixture',
      content: 'Initial fixture text',
      slug,
      draft: true,
    },
  })

  expect(created.ok()).toBe(true)
  await page.goto(`/new/editorial?edit=${slug}`)
  const canvas = page.getByRole('textbox', { name: 'Writing canvas', exact: true })
  await expect(canvas).toHaveValue('Initial fixture text')

  for (const content of ['First browser save', 'Second browser save']) {
    await canvas.fill(content)

    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/content/posts/${slug}`) &&
        response.request().method() === 'PATCH',
    )

    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    expect((await saved).status()).toBe(200)
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible()
  }

  await canvas.fill('My unsaved browser text')

  const remote = await page.request.patch(`/api/content/posts/${slug}`, {
    data: { content: 'Newer connected-app fixture text' },
  })

  expect(remote.ok()).toBe(true)

  const conflicted = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/content/posts/${slug}`) &&
      response.request().method() === 'PATCH',
  )

  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  expect((await conflicted).status()).toBe(409)
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'This post changed in another editor or connected app.' }),
  ).toBeVisible()
  await expect(canvas).toHaveValue('My unsaved browser text')
  const stored = await page.request.get(`/api/content/posts/${slug}/edit`)
  expect(
    Schema.decodeUnknownSync(Schema.Struct({ content: Schema.String }))(await stored.json())
      .content,
  ).toBe('Newer connected-app fixture text')

  if (process.env.MCP_EVIDENCE_DIR)
    await page.screenshot({
      path: `${process.env.MCP_EVIDENCE_DIR}/${info.project.name}-editor-conflict.png`,
      fullPage: true,
    })
})

test('signed-out users see connection context, recover from a bad password and approve read-only tools', async ({
  page,
}, info) => {
  await page.goto('/api/e2e/mcp-start')
  await expect(page.getByRole('heading', { name: 'Connect OpenCode', exact: true })).toBeVisible()
  await expect(page.locator('[data-client-logo]')).toBeVisible()
  await expect(page.getByText('You will review access next', { exact: false })).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Email', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toBeFocused()
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('editor@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('incorrect-password')
  await page.getByRole('button', { name: 'Sign in and continue' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(
    'editor@gbfm.local',
  )
  await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveValue('')

  if (process.env.MCP_EVIDENCE_DIR)
    await page.screenshot({
      path: `${process.env.MCP_EVIDENCE_DIR}/${info.project.name}-login.png`,
      fullPage: true,
    })

  await signIn(page)
  await expect(consent(page)).toBeVisible()
  await expect(page.getByText('editor@gbfm.local', { exact: false })).toBeVisible()
  await expect(page.locator('[data-client-logo]')).toBeVisible()
  await expect(page.getByText('(app on this computer)', { exact: false })).toBeVisible()
  await expect(
    page.getByText('not verified by Goosebumps FM', {
      exact: false,
    }),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )

  if (process.env.MCP_EVIDENCE_DIR)
    await page.screenshot({
      path: `${process.env.MCP_EVIDENCE_DIR}/${info.project.name}-consent.png`,
      fullPage: true,
    })

  await page.getByRole('button', { name: 'Allow connection', exact: true }).click()
  await expect(
    page.getByText('Connected to local GBFM. Available tools: list_drafts, get_post.'),
  ).toBeVisible()
})

test('draft-write consent accurately limits editing to owned unpublished drafts', async ({
  page,
}, info) => {
  await page.goto('/api/e2e/mcp-start?write=1')
  await signIn(page)
  await expect(consent(page)).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Read and draft-write access', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Create and edit your own unpublished editorial drafts'),
  ).toBeVisible()
  await expect(
    page.getByText('Cannot publish, delete, upload files or edit published posts.'),
  ).toBeVisible()
  await expect(page.getByText('Read-only access', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )

  if (process.env.MCP_EVIDENCE_DIR)
    await page.screenshot({
      path: `${process.env.MCP_EVIDENCE_DIR}/${info.project.name}-draft-consent.png`,
      fullPage: true,
    })
  await page.getByRole('button', { name: 'Allow connection', exact: true }).click()
  await expect(
    page.getByText(
      'Connected to local GBFM. Available tools: create_draft, update_draft, list_drafts, get_post.',
    ),
  ).toBeVisible()
})

test('a website session reaches consent even when the API authorization host has no cookie', async ({
  page,
  context,
}) => {
  const signedIn = await page.request.post('/auth/sign-in/email', {
    data: { email: 'editor@gbfm.local', password: 'LocalTest123!' },
    headers: { origin: 'https://gbfm-oauth-onboarding.localhost' },
  })

  expect(signedIn.ok()).toBe(true)
  expect(
    (await context.cookies('https://gbfm-oauth-onboarding-api.localhost')).some((cookie) =>
      cookie.name.includes('session_token'),
    ),
  ).toBe(false)
  await page.goto('/api/e2e/mcp-start')
  await expect(consent(page)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveCount(0)
  const legacyReturn = `/connect/gbfm?${new URL(page.url()).searchParams}`
  await page.goto(`/auth/sign-in?${new URLSearchParams({ returnTo: legacyReturn })}`)
  await expect(consent(page)).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page).toHaveURL(/error=access_denied/)
  expect(new URL(page.url()).searchParams.has('code')).toBe(false)
})

for (const requirement of ['prompt=login', 'max_age=0'])
  test(`fresh authentication (${requirement}) is not bypassed by the website session`, async ({
    page,
  }) => {
    const signedIn = await page.request.post('/auth/sign-in/email', {
      data: { email: 'editor@gbfm.local', password: 'LocalTest123!' },
      headers: { origin: 'https://gbfm-oauth-onboarding.localhost' },
    })

    expect(signedIn.ok()).toBe(true)
    await page.goto(`/api/e2e/mcp-start?${requirement}`)
    await expect(
      page.getByText('For this connection, the app requires you to sign in again.'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Allow connection' })).toHaveCount(0)
    await signIn(page)
    await expect(consent(page)).toBeVisible()
  })

test('switching accounts preserves the request and displays the newly authenticated account', async ({
  page,
}) => {
  await page.goto('/api/e2e/mcp-start')
  await signIn(page)
  await expect(consent(page)).toBeVisible()
  await page.getByRole('button', { name: 'Use another account' }).click()
  await expect(page.getByRole('button', { name: 'Sign in and continue' })).toBeVisible()
  await signIn(page, 'creator@gbfm.local')
  await expect(consent(page)).toBeVisible()
  await expect(page.getByText('creator@gbfm.local', { exact: false })).toBeVisible()
  await expect(page.getByText('editor@gbfm.local', { exact: false })).toHaveCount(0)
})

test('signed-out cancellation returns access_denied to the validated app without granting access', async ({
  page,
}) => {
  await page.goto('/api/e2e/mcp-start')
  await page.getByRole('button', { name: 'Cancel connection' }).click()
  await expect(page).toHaveURL(/error=access_denied/)
  const url = new URL(page.url())
  expect(url.searchParams.has('code')).toBe(false)
  expect(url.searchParams.get('state')).toBeTruthy()
  expect(url.searchParams.get('iss')).toBe('https://gbfm-oauth-onboarding-api.localhost/auth')
})

test('tampered requests show a branded recovery screen, never consent', async ({ page }) => {
  await page.goto('/api/e2e/mcp-start')
  const url = new URL(page.url())
  url.searchParams.set('sig', 'tampered')
  const response = await page.goto(url.href)
  expect(response?.status()).toBe(400)
  await expect(page.getByRole('heading', { name: 'Connection not completed' })).toBeVisible()
  await expect(page.getByText('This request expired.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Allow connection' })).toHaveCount(0)
})

test('an ineligible website account gets an editorial-access explanation instead of another login form', async ({
  page,
}) => {
  const signedIn = await page.request.post('/auth/sign-in/email', {
    data: { email: 'listener@gbfm.local', password: 'LocalTest123!' },
    headers: { origin: 'https://gbfm-oauth-onboarding.localhost' },
  })

  expect(signedIn.ok()).toBe(true)
  await page.goto('/api/e2e/mcp-start')
  await expect(page.getByRole('heading', { name: 'This account cannot connect' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Password' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Use another account' }).click()
  await signIn(page)
  await expect(consent(page)).toBeVisible()
})
