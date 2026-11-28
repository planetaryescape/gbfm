import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { HtmlServer } from '@effect/ui/html'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { Effect } from 'effect'

import { TextareaApp } from './hydration-textarea/App'

const build = promisify(execFile)

const initialSource = 'Original body'

const prepare = async (page: Page, info: TestInfo, source = initialSource) => {
  const entry = fileURLToPath(new URL('./hydration-textarea/client.ts', import.meta.url))
  const output = info.outputPath('hydration-textarea.js')
  await build('bun', ['build', entry, '--target=browser', '--format=iife', `--outfile=${output}`])
  const props = { initialSource: source }
  const rendered = await Effect.runPromise(HtmlServer.renderToHtml(TextareaApp, props))
  await page.goto('about:blank')
  await page.setContent(
    `<!doctype html><html><body><div id="app">${rendered.html}</div>` +
      `<script id="fixture-props" type="application/json">${JSON.stringify(props).replaceAll('<', '\\u003c')}</script>` +
      `<script id="fixture-state" type="application/json">${HtmlServer.serializeState(rendered.state)}</script>` +
      '</body></html>',
  )
  const sourceField = page.getByRole('textbox', { name: 'Source', exact: true })
  await expect(sourceField).toHaveCount(1)
  await expect(sourceField).toHaveValue(source)
  const original = await sourceField.elementHandle()

  if (!original) throw new Error('Missing server textarea')

  return {
    sourceField,
    hydrate: async () => {
      await page.addScriptTag({ path: output })
      await expect(page.locator('#app')).toHaveAttribute('data-adopted', 'true')
      expect(await original.evaluate((node) => node === document.querySelector('textarea'))).toBe(
        true,
      )
      await expect(sourceField).toHaveCount(1)
    },
  }
}

for (const source of [initialSource, '\nOriginal body\n<&"']) {
  test(`pristine textarea keeps native defaults and model without a false edit: ${JSON.stringify(source)}`, async ({
    page,
  }, info) => {
    const { sourceField, hydrate } = await prepare(page, info, source)
    await hydrate()
    await expect(sourceField).toHaveValue(source)
    await expect(sourceField).toHaveJSProperty('defaultValue', source)
    await expect(page.getByLabel('Model source', { exact: true })).toHaveText(source)
    await expect(page.getByLabel('Input count', { exact: true })).toHaveText('0')
    await expect(page.getByLabel('Change count', { exact: true })).toHaveText('0')
  })
}

test('a genuine pre-hydration edit reaches the model exactly once', async ({ page }, info) => {
  const { sourceField, hydrate } = await prepare(page, info)
  await sourceField.fill('User source before hydration')
  await sourceField.blur()
  await hydrate()
  await expect(sourceField).toHaveValue('User source before hydration')
  await expect(sourceField).toHaveJSProperty('defaultValue', initialSource)
  await expect(page.getByLabel('Model source', { exact: true })).toHaveText(
    'User source before hydration',
  )
  await expect(page.getByLabel('Input count', { exact: true })).toHaveText('1')
  await expect(page.getByLabel('Change count', { exact: true })).toHaveText('1')
})

test('normal post-hydration input and controlled updates remain live', async ({ page }, info) => {
  const { sourceField, hydrate } = await prepare(page, info)
  await hydrate()
  await sourceField.fill('User source after hydration')
  await sourceField.blur()
  await expect(page.getByLabel('Model source', { exact: true })).toHaveText(
    'User source after hydration',
  )
  await expect(page.getByLabel('Input count', { exact: true })).toHaveText('1')
  await expect(page.getByLabel('Change count', { exact: true })).toHaveText('1')
  await page.getByRole('button', { name: 'Apply remote source', exact: true }).click()
  await expect(sourceField).toHaveValue('Later server source')
  await expect(page.getByLabel('Model source', { exact: true })).toHaveText('Later server source')
  await expect(page.getByLabel('Input count', { exact: true })).toHaveText('1')
  await expect(sourceField).toHaveJSProperty('defaultValue', initialSource)
})
