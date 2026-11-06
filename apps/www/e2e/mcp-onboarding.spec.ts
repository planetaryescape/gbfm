import { expect, test, type Page } from '@playwright/test'
import { Match } from 'effect'

let fixtureClient = 1

test.beforeEach(async ({ context }, info) => {
  const subnet = Match.value(info.project.name).pipe(
    Match.when('desktop', () => 0),
    Match.when('tablet', () => 1),
    Match.orElse(() => 2),
  )

  await context.setExtraHTTPHeaders({ 'cf-connecting-ip': `198.18.${subnet}.${fixtureClient++}` })
})

const signIn = async (page: Page, email = 'editor@gbfm.local') => {
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in and continue', exact: true }).click()
}

const consent = (page: Page) =>
  page.getByRole('heading', { name: 'Connect Disposable editorial client?', exact: true })

test('signed-out users see connection context, recover from a bad password and approve read-only tools', async ({
  page,
}, info) => {
  await page.goto('/api/e2e/mcp-start')
  await expect(
    page.getByRole('heading', { name: 'Connect Disposable editorial client', exact: true }),
  ).toBeVisible()
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
    page.getByText('Connected to local GBFM. Read-only tools: list_drafts, get_post.'),
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
