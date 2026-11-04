import { expect, test, type Page } from '@playwright/test'

import type * as Fixture from './fixtures/api-key-issuance'

const metadata = {
  id: 'c63400ba-984d-4d4e-91ce-3b1722cc28f2',
  ownerUserId: 'owner',
  name: 'Disposable runtime fixture',
  environment: 'dev',
  scopes: ['posts:read'],
  displayPrefix: 'gbfm_pat_v1_dev_abcdef',
  createdAt: '2026-11-02T10:00:00.000Z',
  expiresAt: '2026-12-02T10:00:00.000Z',
  revokedAt: null,
  lastUsedAt: null,
}

const issued = { key: metadata, secret: 'disposable-runtime-fixture' }

const start = async (page: Page) => {
  await page.route('**/@vite/client', (route) =>
    route.request().isNavigationRequest()
      ? route.fulfill({
          contentType: 'text/html',
          headers: { 'Permissions-Policy': 'clipboard-write=()' },
          body: '<!doctype html><title>Disposable issuance fixture</title>',
        })
      : route.continue(),
  )
  await page.route('**/auth/get-session', (route) =>
    route.fulfill({ json: { user: { id: 'owner', email: 'fixture@example.test' }, session: {} } }),
  )
  await page.goto('/@vite/client')
  await page.setContent(`<section id="fixture">
    <form data-key-create-form>
      <input name="name" aria-label="Name" value="Disposable runtime fixture">
      <input type="checkbox" name="scopes" value="posts:read" checked>
      <input name="expiresInSeconds" value="86400">
      <button type="submit" disabled>Create key</button>
    </form>
    <div data-key-secret></div><p data-key-status></p>
    <dialog data-key-password-dialog><form data-key-password-form>
      <input type="password" aria-label="Password"><button type="submit">Confirm</button>
    </form></dialog>
  </section>`)
  await page.evaluate(async () => {
    const fixturePath = '/e2e/fixtures/api-key-issuance.ts'
    const { mountIssuanceFixture }: typeof Fixture = await import(fixturePath)
    mountIssuanceFixture()
  })
  await expect(page.getByRole('button', { name: 'Create key', exact: true })).toBeEnabled()
}

const setViewState = async (page: Page, state: 'Live' | 'Paused') => {
  const fixture = page.locator('#fixture')
  const version = Number(await fixture.getAttribute('data-view-version'))
  await page.evaluate((state) => {
    window.dispatchEvent(new Event(state === 'Live' ? 'fixture:live' : 'fixture:pause'))
  }, state)
  await expect(fixture).toHaveAttribute('data-view-version', String(version + 1))
  await expect(fixture).toHaveAttribute('data-view-state', state)
}

const confirm = async (page: Page) => {
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('disposable-password')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
}

test('validates locally, cancels settings, and retries password failure without duplicate issuance', async ({
  page,
}) => {
  let confirmations = 0
  let creations = 0
  await page.route('**/auth/sign-in/email', (route) => {
    confirmations += 1

    return route.fulfill({ status: confirmations === 1 ? 401 : 200, json: {} })
  })
  await page.route('**/api/user/api-keys', (route) => {
    creations += 1

    return route.fulfill({ json: issued })
  })
  await start(page)
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('')
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  await expect(page.locator('[data-key-status]')).toContainText('Enter a name')
  expect(confirmations).toBe(0)
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Disposable runtime fixture')
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  await expect(page.locator('dialog')).toBeVisible()
  await page.evaluate(() => document.querySelector('dialog')?.close())
  await expect(page.getByRole('button', { name: 'Create key', exact: true })).toBeEnabled()
  await confirm(page)
  await expect(page.locator('#fixture')).toHaveAttribute(
    'data-failure',
    'Incorrect password. Try again.',
  )
  await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toBeEmpty()
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('disposable-password')
  await page.evaluate(() => {
    const form = document.querySelector('[data-key-password-form]')

    if (!(form instanceof HTMLFormElement)) throw new Error('Missing fixture')
    form.requestSubmit()
    form.requestSubmit()
  })
  await expect(page.getByRole('textbox', { name: 'New API key secret', exact: true })).toBeVisible()
  expect(confirmations).toBe(2)
  expect(creations).toBe(1)
})

test('retains a secret after the browser clipboard outcome, then erases it on dismissal and pagehide', async ({
  page,
  browserName,
}) => {
  await page.route('**/auth/sign-in/email', (route) => route.fulfill({ json: {} }))
  await page.route('**/api/user/api-keys', (route) => route.fulfill({ json: issued }))
  await start(page)
  await confirm(page)
  const secret = page.getByRole('textbox', { name: 'New API key secret', exact: true })
  await expect(secret).toBeVisible()
  await page.getByRole('button', { name: 'Copy key', exact: true }).click()
  await expect(page.locator('[data-key-status]')).toContainText(
    browserName === 'webkit' ? 'Key copied' : 'Could not copy',
  )
  await expect(secret).toBeVisible()
  await page.getByRole('button', { name: 'I saved my key', exact: true }).click()
  await expect(secret).toHaveCount(0)
  await confirm(page)
  await expect(secret).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await expect(secret).toHaveCount(0)
})

test('reports issuance during suspension without exposing the one-time secret', async ({
  page,
}) => {
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route('**/auth/sign-in/email', (route) => route.fulfill({ json: {} }))
  await page.route('**/api/user/api-keys', async (route) => {
    requested.resolve()
    await release.promise
    await route.fulfill({ json: issued })
  })
  await start(page)
  await confirm(page)
  await requested.promise
  await setViewState(page, 'Paused')
  await expect(page.getByRole('button', { name: 'Create key', exact: true })).toBeDisabled()
  release.resolve()
  await expect(page.locator('[data-key-status]')).toContainText(
    'issued after this confirmation was cleared',
  )
  await expect(page.getByRole('textbox', { name: 'New API key secret', exact: true })).toHaveCount(
    0,
  )
})

for (const event of ['pagehide', 'fixture:pause']) {
  test(`does not issue after ${event} clears an in-flight password confirmation`, async ({
    page,
  }) => {
    const requested = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let creations = 0
    await page.route('**/auth/sign-in/email', async (route) => {
      requested.resolve()
      await release.promise
      await route.fulfill({ json: {} })
    })
    await page.route('**/api/user/api-keys', (route) => {
      creations += 1

      return route.fulfill({ json: issued })
    })
    await start(page)
    await confirm(page)
    await requested.promise

    if (event === 'fixture:pause') await setViewState(page, 'Paused')
    else await page.evaluate((event) => window.dispatchEvent(new Event(event)), event)
    await expect(page.getByRole('button', { name: 'Create key', exact: true })).toBeDisabled()
    release.resolve()
    await expect(page.locator('#fixture')).toHaveAttribute(
      'data-failure',
      'Confirmation was cancelled. Close this dialog and try again.',
    )
    expect(creations).toBe(0)
    await expect(
      page.getByRole('textbox', { name: 'New API key secret', exact: true }),
    ).toHaveCount(0)
  })
}

for (const { clear, restore } of [
  { clear: 'pagehide', restore: 'none' },
  { clear: 'pagehide', restore: 'pageshow' },
  { clear: 'pagehide', restore: 'fixture:live' },
  { clear: 'fixture:pause', restore: 'fixture:live' },
]) {
  test(`discards late issuance after ${clear} with ${restore} restoration and allows a fresh request`, async ({
    page,
  }) => {
    const requested = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let creations = 0
    await page.route('**/auth/sign-in/email', (route) => route.fulfill({ json: {} }))
    await page.route('**/api/user/api-keys', async (route) => {
      creations += 1
      requested.resolve()
      await release.promise
      await route.fulfill({ json: issued })
    })
    await start(page)
    await confirm(page)
    await requested.promise

    if (clear === 'fixture:pause') await setViewState(page, 'Paused')
    else await page.evaluate((event) => window.dispatchEvent(new Event(event)), clear)

    if (restore === 'fixture:live') await setViewState(page, 'Live')
    else if (restore !== 'none')
      await page.evaluate((event) => window.dispatchEvent(new Event(event)), restore)
    await expect(page.getByRole('button', { name: 'Create key', exact: true })).toBeDisabled()
    release.resolve()
    await expect(page.locator('[data-key-status]')).toContainText('Revoke it from the list')
    await expect(
      page.getByRole('textbox', { name: 'New API key secret', exact: true }),
    ).toHaveCount(0)
    expect(creations).toBe(1)
    await expect(page.getByRole('button', { name: 'Create key', exact: true })).toBeEnabled()
    await confirm(page)
    await expect(
      page.getByRole('textbox', { name: 'New API key secret', exact: true }),
    ).toBeVisible()
    expect(creations).toBe(2)
  })
}

for (const failure of ['password', 'issuance']) {
  test(`allows a fresh request after ${failure} fails following pagehide`, async ({ page }) => {
    const requested = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let confirmations = 0
    let creations = 0
    await page.route('**/auth/sign-in/email', async (route) => {
      confirmations += 1

      if (failure === 'password' && confirmations === 1) {
        requested.resolve()
        await release.promise

        return route.fulfill({ status: 401, json: {} })
      }

      return route.fulfill({ json: {} })
    })
    await page.route('**/api/user/api-keys', async (route) => {
      creations += 1

      if (failure === 'issuance' && creations === 1) {
        requested.resolve()
        await release.promise

        return route.fulfill({ status: 500, json: {} })
      }

      return route.fulfill({ json: issued })
    })
    await start(page)
    await confirm(page)
    await requested.promise
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    release.resolve()
    await expect(page.locator('#fixture')).toHaveAttribute(
      'data-message',
      'PasswordVerificationFailed',
    )
    await page.evaluate(() => document.querySelector('dialog')?.close())
    await expect(page.getByRole('button', { name: 'Create key', exact: true })).toBeEnabled()
    await expect(
      page.getByRole('textbox', { name: 'New API key secret', exact: true }),
    ).toHaveCount(0)
    await confirm(page)
    await expect(
      page.getByRole('textbox', { name: 'New API key secret', exact: true }),
    ).toBeVisible()
    expect(confirmations).toBe(2)
    expect(creations).toBe(failure === 'password' ? 1 : 2)
  })
}
