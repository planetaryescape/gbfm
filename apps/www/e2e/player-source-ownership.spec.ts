import { expect, test, type Page } from '@playwright/test'

import type * as Fixture from './fixtures/player-source-ownership'

const wave = (seconds: number) => {
  const samples = 8000 * seconds
  const data = Buffer.alloc(44 + samples * 2)
  data.write('RIFF')
  data.writeUInt32LE(36 + samples * 2, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(8000, 24)
  data.writeUInt32LE(16000, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(samples * 2, 40)

  for (let sample = 0; sample < samples; sample++)
    data.writeInt16LE(Math.round(Math.sin((sample * Math.PI) / 10) * 1000), 44 + sample * 2)

  return data
}

const inspect = (page: Page) =>
  page.evaluate(async () => {
    const path = '/e2e/fixtures/player-source-ownership.ts'
    const fixture: typeof Fixture = await import(path)

    return fixture.inspect()
  })

const start = async (page: Page, duration = 8) => {
  await page.route('**/fixture-one.wav', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: wave(duration) }),
  )
  await page.route('**/fixture-two.wav', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: wave(8) }),
  )
  await page.route('**/@vite/client', (route) =>
    route.request().isNavigationRequest()
      ? route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>Source ownership fixture</title>',
        })
      : route.continue(),
  )
  await page.goto('/@vite/client')
  await page.evaluate(async () => {
    const path = '/e2e/fixtures/player-source-ownership.ts'
    const fixture: typeof Fixture = await import(path)
    fixture.mountPlayerSourceFixture()
  })
}

test('real media instances play independently and stale old DOM events cannot complete the replacement', async ({
  page,
}) => {
  await start(page)
  await page.getByRole('button', { name: 'start', exact: true }).click()
  await expect.poll(async () => (await inspect(page)).instances[0]?.position).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'replace', exact: true }).click()
  await expect.poll(async () => (await inspect(page)).instances[1]?.position).toBeGreaterThan(0)
  const before = await inspect(page)
  expect(before.instances[0]).toMatchObject({ src: null, playing: false })
  expect(before.instances[1]).toMatchObject({ playing: true, volume: 0.35, muted: false })
  await page.evaluate(async () => {
    const path = '/e2e/fixtures/player-source-ownership.ts'
    const fixture: typeof Fixture = await import(path)
    fixture.deliverOldEvents()
  })
  expect((await inspect(page)).events.filter((status) => status.didJustFinish)).toEqual([])
  await page.getByRole('button', { name: 'clear', exact: true }).click()
  await expect
    .poll(async () =>
      (await inspect(page)).instances.every((audio) => audio.src === null && !audio.playing),
    )
    .toBe(true)
  await page.getByRole('button', { name: 'dispose', exact: true }).click()
  await expect(page.getByRole('button', { name: 'dispose', exact: true })).toHaveAttribute(
    'data-completed',
    'true',
  )
})

test('a fresh source instance can autoplay queue continuation after real media ends', async ({
  page,
}) => {
  await start(page, 0.5)
  await page.getByRole('button', { name: 'continue', exact: true }).click()
  await expect.poll(async () => (await inspect(page)).instances[1]?.position).toBeGreaterThan(0)
  const current = await inspect(page)
  expect(current.events).toContainEqual(
    expect.objectContaining({ sourceGeneration: 1, didJustFinish: true }),
  )
  expect(current.instances[1]?.playing).toBe(true)
  expect(current.instances[0]).toMatchObject({ src: null, playing: false })
  await page.getByRole('button', { name: 'dispose', exact: true }).click()
  await expect
    .poll(async () =>
      (await inspect(page)).instances.every((audio) => audio.src === null && !audio.playing),
    )
    .toBe(true)
})
