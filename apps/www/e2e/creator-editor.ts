import { expect, type Locator } from '@playwright/test'

export const expectCanvasSource = async (canvas: Locator, source: string) => {
  await expect(canvas).toHaveCount(1)
  await canvas.scrollIntoViewIfNeeded()
  await expect(canvas.locator('.cm-line')).not.toHaveCount(0)
  await expect
    .poll(async () => (await canvas.locator('.cm-line').allTextContents()).join('\n'))
    .toBe(source)
}

export const replaceCanvasSource = async (
  canvas: Locator,
  source: { readonly before: string; readonly after: string },
) => {
  await expectCanvasSource(canvas, source.before)
  await canvas.click()
  await canvas.press('ControlOrMeta+A')
  await canvas.page().keyboard.insertText(source.after)
  await expectCanvasSource(canvas, source.after)
}
