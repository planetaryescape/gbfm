import { chromium, expect } from '@playwright/test'
import { build } from 'bun'

import {
  checkExternalPopup,
  checkExternalUnmountRestoration,
  checkRejectedExternalHosts,
  focusExternalUnmountFixtures,
  installExternalUnmountFixture,
} from './external-popup-proof'

const result = await build({
  entrypoints: [new URL('./native-browser-fixture.ts', import.meta.url).pathname],
  target: 'browser',
  minify: false,
})

if (!result.success) throw new Error('Could not bundle the native dashboard fixture.')

const bundle = result.outputs[0]

if (!bundle) throw new Error('Native dashboard fixture bundle is missing.')

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? Bun.which('chromium') ?? undefined,
  headless: true,
  args: ['--no-sandbox'],
})

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'https://dashboard-fixture.test',
  })
  page.on('pageerror', (error) => process.stderr.write(`Browser error: ${error.message}\n`))
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`Browser console: ${message.text()}\n`)
  })
  await page.route('https://dashboard-fixture.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<button id="background">Background</button><main id="app" class="gbfm-dashboard"></main>',
    }),
  )
  await page.goto('https://dashboard-fixture.test/')
  await page.addStyleTag({
    path: new URL('../../src/features/dashboard/native.css', import.meta.url).pathname,
  })
  await page.addScriptTag({ content: await bundle.text(), type: 'module' })
  await expect(page.getByRole('button', { name: 'Create key', exact: true })).toBeEnabled()
  await page.getByLabel('Name', { exact: true }).fill('Fixture agent')
  await page.getByRole('checkbox', { name: 'Read your posts', exact: true }).check()
  await page.getByRole('combobox', { name: 'Expires after' }).selectOption('86400')
  await page.evaluate(() => {
    const host = document.createElement('com-1password-button')
    host.id = 'fixture-before-open'
    document.body.append(host)
  })
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Confirm your password' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Confirm your password' })).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused()
  await expect(page.locator('#background')).toHaveAttribute('aria-hidden', 'true')
  await expect(page.locator('#background')).toHaveAttribute('inert', '')
  await page.evaluate(() => {
    const unknown = document.createElement('unapproved-password-manager')
    unknown.append(document.createElement('button'))
    document.body.append(unknown)
  })
  await expect(page.locator('body > unapproved-password-manager')).toHaveCount(1)
  await expect(page.locator('unapproved-password-manager')).toHaveAttribute('inert', '')
  await expect(page.locator('dialog unapproved-password-manager')).toHaveCount(0)

  for (const tag of ['com-1password-button', 'com-1password-menu']) {
    const point = await page.evaluate((tag) => {
      const cancel = document.querySelector('[data-key-password-form] button[type="button"]')

      if (!(cancel instanceof HTMLButtonElement)) throw new Error('Cancel button is missing.')
      const bounds = cancel.getBoundingClientRect()
      const host = document.querySelector(tag) ?? document.createElement(tag)

      if (!(host instanceof HTMLElement)) throw new Error('Password-manager host is missing.')
      host.id = tag
      host.style.cssText = `display:block;position:fixed;left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px;z-index:2147483647`
      const shadow = host.attachShadow({ mode: 'closed' })
      const button = document.createElement('button')
      button.textContent = 'Use saved password'
      button.style.cssText = 'width:100%;height:100%'
      button.addEventListener('click', () => {
        host.dataset.selected = 'true'
        const password = document.querySelector('[data-key-password-form] input')

        if (password instanceof HTMLInputElement) password.value = 'fixture-autofilled-password'
      })
      shadow.append(button)

      if (!host.isConnected) document.body.append(host)

      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
    }, tag)

    await expect(page.locator(`dialog ${tag}`)).toHaveCount(1)
    await page.mouse.click(point.x, point.y)
    await expect(page.locator(tag)).toHaveAttribute('data-selected', 'true')
    await expect(page.getByRole('heading', { name: 'Confirm your password' })).toBeVisible()
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue(
      'fixture-autofilled-password',
    )
    await expect(page.locator('[data-key-create-form]')).toHaveAttribute('inert', '')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Confirm your password' })).toBeVisible()
    await page.keyboard.press('Tab')
    expect(
      await page.evaluate(() => {
        const active = document.activeElement

        return active !== document.body && Boolean(active?.closest('dialog'))
      }),
    ).toBe(true)
  }

  await checkRejectedExternalHosts(page)
  await checkExternalPopup(page)
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Confirm and create key' }).click()
  await expect(page.getByRole('heading', { name: 'Confirm your password' })).not.toBeVisible()
  await expect(page.locator('[data-key-secret] input')).toHaveValue('fixture-secret-visible-once')
  await expect(page.locator('[data-key-secret] input')).toBeFocused()
  await expect(page.locator('body > com-1password-button')).toHaveCount(1)
  await expect(page.locator('body > com-1password-menu')).toHaveCount(1)
  await expect(page.locator('unapproved-password-manager')).not.toHaveAttribute('inert', '')
  await expect(page.locator('com-1password-button')).not.toHaveAttribute('aria-hidden', 'true')
  await page.getByRole('button', { name: 'Copy key', exact: true }).click()
  await expect(page.locator('[data-key-status]')).toHaveText('Key copied. Store it securely.')
  expect(
    await page
      .locator('#app')
      .evaluate((node) => node.outerHTML.includes('fixture-secret-visible-once')),
  ).toBe(false)
  await page.evaluate(() => document.dispatchEvent(new Event('fixture-snapshot')))
  const modelSnapshot = await page.locator('body').getAttribute('data-model-snapshot')
  expect(modelSnapshot).not.toContain('fixture-secret-visible-once')
  expect(modelSnapshot).not.toContain('fixture-password')
  expect(modelSnapshot).not.toContain('external-disposable-password')
  await page.getByRole('button', { name: 'I saved my key' }).click()
  await expect(page.locator('[data-key-secret] input')).toHaveCount(0)
  await expect(page.locator('body')).toHaveAttribute('data-issued', '1')
  await page.evaluate(() => {
    document
      .querySelectorAll('com-1password-button,com-1password-menu')
      .forEach((node) => node.remove())
    document.getElementById('background')?.addEventListener('click', () => {
      document.body.dataset.backgroundClicks = String(
        Number(document.body.dataset.backgroundClicks ?? 0) + 1,
      )
    })
  })
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Confirm your password' })).toBeVisible()
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Confirm your password' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Create key', exact: true })).toBeFocused()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Fixture agent')
  await expect(page.getByRole('checkbox', { name: 'Read your posts', exact: true })).toBeChecked()
  await expect(page.getByRole('combobox', { name: 'Expires after' })).toHaveValue('86400')
  await expect(page.locator('body')).toHaveAttribute('data-issued', '1')
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Confirm your password' })).toBeVisible()
  const background = await page.locator('#background').boundingBox()

  if (!background) throw new Error('Background fixture is missing.')
  await page.mouse.click(background.x + background.width / 2, background.y + background.height / 2)
  await expect(page.getByRole('heading', { name: 'Confirm your password' })).toBeVisible()
  expect(await page.evaluate(() => Number(document.body.dataset.backgroundClicks ?? 0))).toBe(0)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Confirm your password' })).not.toBeVisible()
  await page.evaluate(() => {
    document.body.dataset.pauseIssue = 'true'
  })
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  await page.getByLabel('Password', { exact: true }).fill('fixture-wrong')
  await page.getByRole('button', { name: 'Confirm and create key' }).click()
  await expect(page.locator('[data-key-password-form]').getByRole('alert')).toHaveText(
    'Incorrect password. Try again.',
  )
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused()
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Confirm and create key' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-issued', '2')
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
  )
  await expect(page.getByRole('heading', { name: 'Confirm your password' })).not.toBeVisible()
  await page.evaluate(() => document.dispatchEvent(new Event('fixture-release-issue')))
  await expect(page.locator('[data-key-status]')).toContainText('Revoke it from the list')
  await expect(page.locator('[data-key-secret] input')).toHaveCount(0)
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  )
  await expect(page.getByRole('button', { name: 'Create key', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    const host = document.createElement('com-1password-menu')
    host.id = 'fixture-unmount-host'
    const shadow = host.attachShadow({ mode: 'closed' })
    shadow.append(document.createElement('button'))
    const next = document.createElement('span')
    next.id = 'fixture-host-next'
    const removed = document.createElement('com-1password-button')
    removed.id = 'fixture-removed-host'
    const inert = document.createElement('aside')
    inert.id = 'fixture-already-inert'
    inert.inert = true
    document.body.append(host, next, removed, inert)
  })
  await installExternalUnmountFixture(page)
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  await expect(page.locator('dialog #fixture-unmount-host')).toHaveCount(1)
  await expect(page.locator('dialog #fixture-removed-host')).toHaveCount(1)
  await focusExternalUnmountFixtures(page)
  await page.evaluate(() => {
    document.getElementById('fixture-removed-host')?.remove()
    document.querySelector('dialog[popover="manual"]')?.remove()
    document.dispatchEvent(new Event('fixture-unmount'))
  })
  await expect(page.locator('[data-key-create-form]')).toHaveCount(0)
  await expect(page.locator('body > #fixture-unmount-host')).toHaveCount(1)
  await expect(page.locator('#fixture-unmount-host + #fixture-host-next')).toHaveCount(1)
  await expect(page.locator('#fixture-removed-host')).toHaveCount(0)
  await expect(page.locator('#background')).not.toHaveAttribute('inert', '')
  await expect(page.locator('#background')).not.toHaveAttribute('aria-hidden', 'true')
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '')
  await expect(page.locator('#app')).not.toHaveAttribute('aria-hidden', 'true')
  await expect(page.locator('#fixture-already-inert')).toHaveAttribute('inert', '')
  await checkExternalUnmountRestoration(page)
  process.stdout.write(
    'PASS: native issuance, focus, closed-shadow overlays, guarded external shadow popup, rejected hosts, background isolation, clipboard, reveal-once, cancellation, pagehide, lost acknowledgement and unmount restoration.\n',
  )
} finally {
  await browser.close()
}
