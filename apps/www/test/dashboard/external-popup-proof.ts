import { expect, type Page } from '@playwright/test'

export const checkRejectedExternalHosts = async (page: Page) => {
  await page.evaluate(() => {
    const create = (id: string, parent: Element, shadow: boolean, focused: boolean) => {
      const host = document.createElement('div')
      host.id = id
      host.style.cssText =
        'position:fixed;top:8px;left:8px;width:120px;height:30px;z-index:2147483647'
      const button = document.createElement('button')
      button.textContent = 'Rejected external host'
      button.addEventListener('click', () => {
        host.dataset.selected = 'true'
      })

      if (shadow) host.attachShadow({ mode: 'open' }).append(button)
      else {
        host.tabIndex = 0
        host.append(button)
      }

      parent.append(host)

      if (focused) {
        if (shadow) button.focus()
        else host.focus()
      }
    }

    create('negative-body-shadow', document.body, true, true)
    create('negative-unfocused-shadow', document.documentElement, true, false)
    create('negative-nonshadow', document.documentElement, false, true)
    const wrapper = document.createElement('div')
    wrapper.id = 'negative-wrapper'
    document.documentElement.append(wrapper)
    create('negative-wrapped-shadow', wrapper, true, true)
    const frame = document.createElement('iframe')
    frame.id = 'negative-crossdocument'
    document.documentElement.append(frame)

    if (!frame.contentDocument) throw new Error('Cross-document fixture missing')
    create('negative-other-document', frame.contentDocument.documentElement, true, true)
  })

  for (const id of [
    'negative-body-shadow',
    'negative-unfocused-shadow',
    'negative-nonshadow',
    'negative-wrapped-shadow',
    'negative-crossdocument',
  ])
    await expect(page.locator(`dialog #${id}`)).toHaveCount(0)
  await expect(page.locator('body > #negative-body-shadow')).toHaveAttribute('inert', '')
  await expect(page.locator('html > #negative-unfocused-shadow')).toHaveCount(1)
  await expect(page.locator('html > #negative-nonshadow')).toHaveCount(1)
  await expect(page.locator('#negative-wrapper > #negative-wrapped-shadow')).toHaveCount(1)
  await expect(
    page.frameLocator('#negative-crossdocument').locator('html > #negative-other-document'),
  ).toHaveCount(1)
  await page.mouse.click(30, 20)
  expect(
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('[id^="negative-"]')).some(
        (node) => node instanceof HTMLElement && node.dataset.selected === 'true',
      ),
    ),
  ).toBe(false)
  await expect(page.locator('[data-key-create-form]')).toHaveAttribute('inert', '')
  await page.evaluate(() => {
    document.querySelectorAll('[id^="negative-"]').forEach((node) => node.remove())
  })
  await page.getByLabel('Password', { exact: true }).focus()
}

export const checkExternalPopup = async (page: Page) => {
  await page.evaluate(() => {
    const host = document.createElement('div')
    host.id = 'external-shadow-fixture'
    host.setAttribute('aria-hidden', 'false')
    host.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647'
    const shadow = host.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    button.textContent = 'Use external saved password'
    button.addEventListener('click', () => {
      host.dataset.selected = 'true'
      const password = document.querySelector('[data-key-password-form] input')

      if (password instanceof HTMLInputElement) {
        password.value = 'external-disposable-password'
        password.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    shadow.append(button)
    const next = document.createElement('span')
    next.id = 'external-shadow-next'
    document.documentElement.append(host, next)
    button.focus()
  })
  await expect(page.locator('dialog #external-shadow-fixture')).toHaveCount(1)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getElementById('external-shadow-fixture')?.shadowRoot?.activeElement
            ?.textContent,
      ),
    )
    .toBe('Use external saved password')
  await page.getByRole('button', { name: 'Use external saved password', exact: true }).click()
  await expect(page.locator('dialog #external-shadow-fixture')).toHaveAttribute(
    'data-selected',
    'true',
  )
  expect(
    await page.evaluate(() => {
      const host = document.getElementById('external-shadow-fixture')

      return host?.shadowRoot?.activeElement?.textContent
    }),
  ).toBe('Use external saved password')
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(
    'external-disposable-password',
  )
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Confirm your password' })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused()
  await page.evaluate(() => {
    const leaf = document
      .getElementById('external-shadow-fixture')
      ?.shadowRoot?.querySelector('button')

    if (leaf instanceof HTMLElement) leaf.focus()
  })
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.getByLabel('Password', { exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Confirm your password' })).not.toBeVisible()
  await expect(page.locator('html > #external-shadow-fixture + #external-shadow-next')).toHaveCount(
    1,
  )
  await expect(page.locator('#external-shadow-fixture')).toHaveAttribute('aria-hidden', 'false')
  await expect(page.locator('#external-shadow-fixture')).not.toHaveAttribute('inert', '')
  await expect(page.getByRole('button', { name: 'Create key', exact: true })).toBeFocused()
  await page.evaluate(() => {
    document.getElementById('external-shadow-fixture')?.remove()
    document.getElementById('external-shadow-next')?.remove()
  })
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused()
}

export const installExternalUnmountFixture = async (page: Page) => {
  await page.evaluate(() => {
    for (const id of ['external-unmount', 'external-removed']) {
      const host = document.createElement('div')
      host.id = id
      host.setAttribute('aria-hidden', 'false')
      const shadow = host.attachShadow({ mode: 'open' })
      shadow.append(document.createElement('button'))
      document.documentElement.append(host)

      if (id === 'external-unmount') {
        const next = document.createElement('span')
        next.id = 'external-unmount-next'
        document.documentElement.append(next)
      }
    }

    const inertHost = document.createElement('com-1password-menu')
    inertHost.id = 'inert-allowed-host'
    inertHost.inert = true
    document.body.append(inertHost)
  })
}

export const focusExternalUnmountFixtures = async (page: Page) => {
  for (const id of ['external-unmount', 'external-removed']) {
    await page.evaluate((id) => {
      const leaf = document.getElementById(id)?.shadowRoot?.querySelector('button')

      if (leaf instanceof HTMLElement) leaf.focus()
    }, id)
    await expect(page.locator(`dialog #${id}`)).toHaveCount(1)
  }

  await page.evaluate(() => document.getElementById('external-removed')?.remove())
}

export const checkExternalUnmountRestoration = async (page: Page) => {
  await expect(page.locator('html > #external-unmount + #external-unmount-next')).toHaveCount(1)
  await expect(page.locator('#external-unmount')).toHaveAttribute('aria-hidden', 'false')
  await expect(page.locator('#external-unmount')).not.toHaveAttribute('inert', '')
  await expect(page.locator('#external-removed')).toHaveCount(0)
  await expect(page.locator('body > #inert-allowed-host')).toHaveAttribute('inert', '')
  await page.evaluate(() => {
    const host = document.createElement('div')
    host.id = 'external-after-owner-ended'
    const shadow = host.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    shadow.append(button)
    document.documentElement.append(host)
    button.focus()
  })
  await expect(page.locator('html > #external-after-owner-ended')).toHaveCount(1)
  await expect(page.locator('dialog #external-after-owner-ended')).toHaveCount(0)
}
