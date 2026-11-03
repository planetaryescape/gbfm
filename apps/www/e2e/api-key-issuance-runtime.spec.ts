import { expect, test, type Page } from '@playwright/test'
import type * as Effects from 'effect'

import type * as Issuance from '../src/page/dashboard/page/api-keys/issuance'

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
    const effectPath = '/@id/effect'
    const issuancePath = '/src/page/dashboard/page/api-keys/issuance.ts'
    const { Effect, Fiber, Predicate, Queue, Stream }: typeof Effects = await import(effectPath)
    const { IssueKey }: typeof Issuance = await import(issuancePath)
    const element = document.getElementById('fixture')
    const dialog = document.querySelector('dialog')

    if (!element || !(dialog instanceof HTMLDialogElement)) throw new Error('Missing fixture')
    const changes = Effect.runSync(Queue.unbounded<'Live' | 'Paused'>())
    Queue.offerUnsafe(changes, 'Live')

    const fiber = Effect.runFork(
      IssueKey({ userId: 'owner' })
        .f(element, Stream.fromQueue(changes))
        .pipe(
          Stream.runForEach((message) =>
            Effect.sync(() => {
              element.dataset.message = message._tag

              if (Predicate.isTagged(message, 'PasswordRequested')) dialog.showModal()

              if (Predicate.isTagged(message, 'PasswordVerificationFailed')) {
                element.dataset.failure = message.message
              }

              if (Predicate.isTagged(message, 'Issued')) dialog.close()
            }),
          ),
        ),
    )

    window.addEventListener('fixture:pause', () => {
      Queue.offerUnsafe(changes, 'Paused')
    })
    window.addEventListener('fixture:live', () => {
      Queue.offerUnsafe(changes, 'Live')
    })
    window.addEventListener('fixture:dispose', () => {
      Effect.runFork(Fiber.interrupt(fiber))
    })
  })
  await expect(page.getByRole('button', { name: 'Create key', exact: true })).toBeEnabled()
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
  await page.evaluate(() => window.dispatchEvent(new Event('fixture:pause')))
  await expect(page.getByRole('button', { name: 'Create key', exact: true })).toBeDisabled()
  release.resolve()
  await expect(page.locator('[data-key-status]')).toContainText('issued while the view was paused')
  await expect(page.getByRole('textbox', { name: 'New API key secret', exact: true })).toHaveCount(
    0,
  )
})

test('characterizes late issuance after pagehide without silently changing its policy', async ({
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
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  release.resolve()
  await expect(page.getByRole('textbox', { name: 'New API key secret', exact: true })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('fixture:dispose')))
  await expect(page.getByRole('textbox', { name: 'New API key secret', exact: true })).toHaveCount(
    0,
  )
})
