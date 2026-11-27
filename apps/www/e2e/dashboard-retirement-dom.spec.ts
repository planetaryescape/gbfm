import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page, type Route } from '@playwright/test'

let bundle = ''

const origin = 'https://native-retirement.test'

const fixtureDirectory = fileURLToPath(new URL('../src/features/dashboard/', import.meta.url))

const css = readFileSync(new URL('../src/features/dashboard/native.css', import.meta.url), 'utf8')

test.beforeAll(() => {
  const program = `
    const result = await Bun.build({
      entrypoints: [${JSON.stringify(fileURLToPath(new URL('../src/features/dashboard/retirement-browser.test-support.ts', import.meta.url)))}], target: 'browser'
    })
    if (!result.success || !result.outputs[0]) throw new Error('Native-only in-memory fixture bundle failed')
    process.stdout.write(await result.outputs[0].text())
  `

  bundle = execFileSync('bun', ['-e', program], {
    cwd: fixtureDirectory,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
})

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => console.error(`Native fixture browser error: ${error.message}`))
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== origin) return route.abort()

    return route.fulfill({
      contentType: 'text/html',
      body: '<button id="background">Background</button><main id="app" class="gbfm-dashboard"></main>',
    })
  })
})

const mount = async (page: Page, mode: string) => {
  await page.goto(`${origin}/?mode=${mode}`)
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: bundle, type: 'module' })
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
}

const installHosts = async (page: Page) => {
  await page.evaluate(() => {
    for (const [index, tag] of ['com-1password-button', 'com-1password-menu'].entries()) {
      const host = document.createElement(tag)
      host.style.cssText = `display:block;position:fixed;left:20px;top:${20 + index * 70}px;width:130px;height:40px;z-index:2147483647`
      const button = document.createElement('button')
      button.textContent = tag
      button.style.cssText = 'width:100%;height:100%'
      button.addEventListener('click', () => {
        host.dataset.selected = 'true'
      })
      host.attachShadow({ mode: 'closed' }).append(button)
      document.body.append(host)
    }
  })
}

const clickHost = async (page: Page, tag: string) => {
  const bounds = await page.locator(tag).boundingBox()

  if (!bounds) throw new Error('Missing extension host bounds')
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
}

test('an unrelated native Dialog grants neither password-manager host an exemption', async ({
  page,
}) => {
  await mount(page, 'unrelated')
  await installHosts(page)
  await page.getByRole('button', { name: 'Open fixture dialog' }).click()
  await expect(page.getByRole('heading', { name: 'Unrelated dialog', exact: true })).toBeVisible()
  expect(await page.locator('dialog').evaluate((node) => node.matches(':popover-open'))).toBe(true)

  for (const tag of ['com-1password-button', 'com-1password-menu']) {
    await expect(page.locator(`body > ${tag}`)).toHaveCount(1)
    await expect(page.locator(tag)).toHaveAttribute('aria-hidden', 'true')
    await clickHost(page, tag)
    await expect(page.locator(tag)).not.toHaveAttribute('data-selected', 'true')
  }
})

test('password confirmation permits BOTH exact hosts on first open, reopen and fresh remount, restoring their parent on close', async ({
  page,
}) => {
  await mount(page, 'password')
  await installHosts(page)

  for (const phase of ['first', 'reopen', 'remount']) {
    if (phase === 'remount') {
      await mount(page, 'password')
      await installHosts(page)
    }

    await page.getByRole('button', { name: 'Open fixture dialog' }).click()
    const dialog = page.getByRole('dialog', { name: 'Confirm your password', exact: true })
    await expect(dialog).toBeVisible()

    for (const tag of ['com-1password-button', 'com-1password-menu']) {
      await expect(page.locator(`dialog.key-password-portal > ${tag}`)).toHaveCount(1)
      await page.locator(tag).evaluate((node) => node.removeAttribute('data-selected'))
      await clickHost(page, tag)
      await expect(page.locator(tag)).toHaveAttribute('data-selected', 'true')
    }

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).not.toBeVisible()

    for (const tag of ['com-1password-button', 'com-1password-menu'])
      await expect(page.locator(`body > ${tag}`)).toHaveCount(1)
    expect(
      await page.locator('body > com-1password-button, body > com-1password-menu').count(),
    ).toBe(2)
  }
})

for (const { sameUser, outcome } of [
  { sameUser: false, outcome: 'success' },
  { sameUser: false, outcome: 'failure' },
  { sameUser: true, outcome: 'success' },
  { sameUser: true, outcome: 'failure' },
]) {
  test(`native user AND session queries reject old ${outcome} after QueryChanged, same-user wrong revision=${sameUser}`, async ({
    page,
  }) => {
    const oldUsers = Promise.withResolvers<Route>()
    const oldSessions = Promise.withResolvers<Route>()
    let searches = 0
    let sessions = 0
    let current = false
    const first = { id: 'one', name: 'One', email: 'one@example.test' }

    const chosen = {
      id: sameUser ? 'one' : 'two',
      name: 'Current',
      email: sameUser ? first.email : 'two@example.test',
    }

    const session = (userId: string, title: string) => ({
      id: title,
      userId,
      token: `synthetic-${title}`,
      userAgent: title,
      ipAddress: null,
      createdAt: '2026-11-01T10:00:00Z',
      expiresAt: '2026-12-01T10:00:00Z',
    })

    await page.route('**/auth/admin/list-users?**', async (route) => {
      searches++

      if (searches === 2) {
        oldUsers.resolve(route)

        return
      }

      await route.fulfill({ json: { users: [current ? chosen : first] } })
    })
    await page.route('**/auth/admin/list-user-sessions', async (route) => {
      sessions++

      if (sessions === 1) {
        oldSessions.resolve(route)

        return
      }

      await route.fulfill({ json: { sessions: [session(chosen.id, 'Current device')] } })
    })
    await mount(page, 'sessions')
    await page.getByRole('searchbox').fill(first.email)
    await page.getByRole('button', { name: 'Search users', exact: true }).click()
    await page
      .getByRole('button', { name: `View sessions for ${first.email}`, exact: true })
      .click()
    const users = await oldUsers.promise
    const previousSessions = await oldSessions.promise
    current = true
    await page.getByRole('searchbox').fill(chosen.email)
    await page.getByRole('button', { name: 'Search users', exact: true }).click()
    await page
      .getByRole('button', { name: `View sessions for ${chosen.email}`, exact: true })
      .filter({ hasText: 'Current' })
      .click()
    await expect(page.getByText('Current device', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Revoke all', exact: true }).click()

    const assertCurrent = async () => {
      await expect(
        page.getByRole('heading', { name: `Current · ${chosen.email}`, exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Confirm revoke all', exact: true }),
      ).toBeEnabled()
      await expect(page.getByText('Current device', { exact: true })).toBeVisible()
      await expect(page.getByText('Obsolete device', { exact: true })).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: 'View sessions for obsolete@example.test', exact: true }),
      ).toHaveCount(0)
      await expect(
        page.getByText('Could not load session data. Refresh to try again.', { exact: true }),
      ).toHaveCount(0)
    }

    await assertCurrent()

    for (const [route, json] of [
      [users, { users: [{ id: 'obsolete', name: 'Obsolete', email: 'obsolete@example.test' }] }],
      [previousSessions, { sessions: [session(first.id, 'Obsolete device')] }],
    ] satisfies Array<[Route, object]>) {
      if (outcome === 'failure') await route.fulfill({ status: 503, json: {} })
      else await route.fulfill({ json })
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
      await assertCurrent()
    }

    expect(searches).toBeGreaterThanOrEqual(3)
    expect(sessions).toBe(2)
  })
}
