import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { replaceCanvasSource } from './creator-editor'

const build = promisify(execFile)

const entry = fileURLToPath(
  new URL('../src/features/creator/test-fixtures/editor-dom.ts', import.meta.url),
)

const mountEditor = async (page: Page, info: TestInfo, belowFold = false) => {
  const output = info.outputPath('editor-dom.js')
  await build('bun', ['build', entry, '--target=browser', '--format=iife', `--outfile=${output}`])
  await page.goto(belowFold ? 'about:blank#offscreen' : 'about:blank')
  await page.setContent('<main id="app"></main>')
  await page.addScriptTag({ path: output })
}

test('the real editor renders its initial document and subsequent mount arguments exactly once', async ({
  page,
}, info) => {
  await mountEditor(page, info)
  const canvas = page.getByRole('textbox', { name: 'Writing canvas', exact: true })
  await expect(canvas).toHaveCount(1)
  await expect.poll(() => canvas.innerText()).toBe('Initial saved body')
  await page.getByRole('textbox', { name: 'Pending remote source' }).fill('Later remote body')
  await page.getByRole('button', { name: 'Apply remote source' }).click()
  await expect.poll(() => canvas.innerText()).toBe('Later remote body')
  await expect(canvas).toHaveCount(1)
  await expect(page.getByLabel('Current source')).toHaveText('Later remote body')
})

test('focus argument changes preserve the real editor document and undo history', async ({
  page,
}, info) => {
  await mountEditor(page, info)
  const canvas = page.getByRole('textbox', { name: 'Writing canvas', exact: true })
  await expect(canvas).toHaveCount(1)
  await expect.poll(() => canvas.innerText()).toBe('Initial saved body')
  await page.getByRole('textbox', { name: 'Pending remote source' }).fill('Later remote body')
  await page.getByRole('button', { name: 'Apply remote source' }).click()
  await expect.poll(() => canvas.innerText()).toBe('Later remote body')
  await canvas.click()
  await canvas.press('Control+End')
  await page.keyboard.type(' with local edits')
  await expect.poll(() => canvas.innerText()).toBe('Later remote body with local edits')
  await page.getByRole('button', { name: 'Focus editor', exact: true }).click()
  await expect(canvas).toBeFocused()
  await page.getByRole('button', { name: 'Release focus intent' }).click()
  await page.getByRole('button', { name: 'Focus editor', exact: true }).click()
  await expect(canvas).toBeFocused()
  await expect(canvas).toHaveCount(1)
  await canvas.press('Control+z')
  await expect.poll(() => canvas.innerText()).toBe('Later remote body')
})

test('unmounting releases the old editor and remounting creates one editor with the retained document', async ({
  page,
}, info) => {
  await mountEditor(page, info)
  const canvas = page.getByRole('textbox', { name: 'Writing canvas', exact: true })
  await expect.poll(() => canvas.innerText()).toBe('Initial saved body')
  await replaceCanvasSource(canvas, {
    before: 'Initial saved body',
    after: 'Retained source after unmount',
  })
  await info.attach('editor-after-user-replacement', {
    body: JSON.stringify(await page.evaluate(() => window.readCreatorEditor())),
    contentType: 'application/json',
  })
  await expect.poll(() => canvas.innerText()).toBe('Retained source after unmount')
  await page.getByRole('button', { name: 'Toggle editor' }).click()
  await expect(canvas).toHaveCount(0)
  await page.getByRole('button', { name: 'Toggle editor' }).click()
  await expect(canvas).toHaveCount(1)
  await expect.poll(() => canvas.innerText()).toBe('Retained source after unmount')
})

test('an offscreen editor retains its actual document and renders it when brought into view', async ({
  page,
}, info) => {
  await mountEditor(page, info, true)
  const canvas = page.getByRole('textbox', { name: 'Writing canvas', exact: true })
  await expect(canvas).toHaveCount(1)
  await expect
    .poll(() => page.evaluate(() => window.readCreatorEditor().document))
    .toBe('Initial saved body')
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  await info.attach('offscreen-editor-state', {
    body: JSON.stringify(await page.evaluate(() => window.readCreatorEditor())),
    contentType: 'application/json',
  })
  await expect
    .poll(() => page.evaluate(() => window.readCreatorEditor().document))
    .toBe('Initial saved body')
  await canvas.scrollIntoViewIfNeeded()
  await expect(canvas).toHaveCount(1)
  await expect.poll(() => canvas.innerText()).toBe('Initial saved body')
})

test('exact source replacement preserves empty documents, blank lines and trailing newlines', async ({
  page,
}, info) => {
  await mountEditor(page, info)
  const canvas = page.getByRole('textbox', { name: 'Writing canvas', exact: true })
  const sourceModel = page.getByLabel('Current source')

  const checkpoints: Array<{
    source: string
    document: string | null
    model: string | null
    visibleLines: string
  }> = []

  let before = 'Initial saved body'

  for (const after of ['', '\n', '\nA\n\nB\n', '']) {
    await expect.poll(() => page.evaluate(() => window.readCreatorEditor().document)).toBe(before)
    await expect.poll(() => sourceModel.textContent()).toBe(before)
    await replaceCanvasSource(canvas, { before, after })
    await expect.poll(() => page.evaluate(() => window.readCreatorEditor().document)).toBe(after)
    await expect.poll(() => sourceModel.textContent()).toBe(after)
    await expect(canvas).toHaveCount(1)
    checkpoints.push({
      source: after,
      document: await page.evaluate(() => window.readCreatorEditor().document),
      model: await sourceModel.textContent(),
      visibleLines: (await canvas.locator('.cm-line').allTextContents()).join('\n'),
    })
    before = after
  }

  await info.attach('exact-source-checkpoints', {
    body: JSON.stringify(checkpoints),
    contentType: 'application/json',
  })
})
