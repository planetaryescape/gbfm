import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

const build = promisify(execFile)

const mountImport = async (page: Page, info: TestInfo) => {
  const entry = fileURLToPath(
    new URL('../src/features/listening/test-fixtures/import-panel.ts', import.meta.url),
  )

  const output = info.outputPath('listening-import.js')

  await build('bun', ['build', entry, '--target=browser', '--format=iife', `--outfile=${output}`])
  await page.route('http://fixture.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<main id="app"></main>' }),
  )
  await page.goto('http://fixture.test/listening')
  await page.addScriptTag({ path: output })
}

test('an open import form retains its draft and submit control across workspace updates', async ({
  page,
}, info) => {
  await mountImport(page, info)
  const panel = page.locator('details').filter({ has: page.locator('form[method="get"]') })

  await page.locator('summary').filter({ hasText: '+ Add mixes' }).click()
  await expect(panel).toHaveJSProperty('open', true)
  const input = page.getByRole('textbox', { name: 'Mix or public playlist URL', exact: true })
  const url = 'https://soundcloud.com/fixture/retained-draft'

  await input.fill(url)
  await page.getByRole('button', { name: 'Refresh workspace', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Workspace refreshed.')
  await expect(panel).toHaveJSProperty('open', true)
  await expect(input).toHaveValue(url)
  await expect(page.getByRole('button', { name: 'Preview import', exact: true })).toBeVisible()

  const form = panel.locator('form[method="get"]')

  await form.evaluate((element) => {
    if (!(element instanceof HTMLFormElement)) throw new Error('Expected the import GET form')

    element.addEventListener('submit', () => {
      const input = element.elements.namedItem('import')

      if (!(input instanceof HTMLInputElement)) throw new Error('Expected the import URL input')

      element.dataset.submittedImport = input.value
    })
  })
  await page.getByRole('button', { name: 'Preview import', exact: true }).click()
  await expect(form).toHaveAttribute('data-submitted-import', url)
})

test('a preview opens the panel without overriding a later explicit dismissal on refresh', async ({
  page,
}, info) => {
  await mountImport(page, info)
  const panel = page.locator('details').filter({ has: page.locator('form[method="get"]') })

  await expect(panel).toHaveJSProperty('open', false)
  await page.getByRole('button', { name: 'Receive import preview', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Import preview · 1 mixes', exact: true }),
  ).toBeVisible()
  await expect(panel).toHaveJSProperty('open', true)
  await page.locator('summary').filter({ hasText: '+ Add mixes' }).click()
  await expect(panel).toHaveJSProperty('open', false)
  await page.getByRole('button', { name: 'Refresh workspace', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Workspace refreshed.')
  await expect(panel).toHaveJSProperty('open', false)
})
