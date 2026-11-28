import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { Schema } from 'effect'

const build = promisify(execFile)

type AudioResponseHeaders = {
  'content-type': string
  'accept-ranges': string
  'content-length': string
  'content-range'?: string
}

const Platform = Schema.Struct({
  audioTime: Schema.NullOr(Schema.Number),
  paused: Schema.NullOr(Schema.Boolean),
  loaded: Schema.Boolean,
  waiting: Schema.Boolean,
  seeks: Schema.Array(Schema.Number),
})

const Entry = Schema.Struct({
  kind: Schema.String,
  incomingPosition: Schema.optional(Schema.Number),
  modelTime: Schema.optional(Schema.NullOr(Schema.Number)),
  inputValue: Schema.optional(Schema.Number),
  seconds: Schema.optional(Schema.Number),
  referenceSeconds: Schema.optional(Schema.Number),
  audioTime: Schema.optional(Schema.NullOr(Schema.Number)),
  hillTarget: Schema.optional(Schema.Boolean),
})

const platform = async (page: Page) =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Platform))(
    await page.locator('#platform').textContent(),
  )

const evidence = async (page: Page) =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Entry)))(
    await page.locator('#evidence').textContent(),
  )

const action = async (page: Page, name: string) => {
  const button = page.getByRole('button', { name, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('data-status', 'complete')
}

const wave = (duration: number) => {
  const samples = 8000 * duration
  const bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(8000, 24)
  bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(samples * 2, 40)

  return bytes
}

for (const scenario of [
  { duration: 30, move: 128, resolution: 'commit' },
  { duration: 30, move: 128, resolution: 'cancel' },
  { duration: 60, move: 76, resolution: 'commit' },
] satisfies ReadonlyArray<{ duration: number; move: number; resolution: 'commit' | 'cancel' }>) {
  test(`Home retains the exact 15-second reference across an old engine status: ${scenario.duration}s ${scenario.resolution}`, async ({
    page,
  }, info) => {
    const output = info.outputPath('home-touch.js')
    const entry = fileURLToPath(new URL('./player-home-touch/client.ts', import.meta.url))
    await build('bun', ['build', entry, '--target=browser', '--format=esm', `--outfile=${output}`])
    await page.route('http://player-fixture.test/audio.wav', async (route) => {
      const request = route.request()
      const bytes = wave(scenario.duration)
      const range = request.headers().range
      const match = range?.match(/^bytes=(\d+)-(\d*)$/)
      const start = range ? Number(match?.[1]) : 0
      const end = match?.[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1

      if (!Number.isSafeInteger(start) || start < 0 || start > end || start >= bytes.length) {
        await route.fulfill({
          status: 416,
          headers: { 'content-range': `bytes */${bytes.length}` },
        })

        return
      }

      const headers: AudioResponseHeaders = {
        'content-type': 'audio/wav',
        'accept-ranges': 'bytes',
        'content-length': String(end - start + 1),
      }

      if (range) headers['content-range'] = `bytes ${start}-${end}/${bytes.length}`

      await route.fulfill({
        status: range ? 206 : 200,
        headers,
        body: bytes.subarray(start, end + 1),
      })
    })
    await page.route('http://player-fixture.test/', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="controls"></div><div id="app"></div><pre id="platform"></pre><pre id="evidence"></pre>
<style>pre{display:none}.hill-scrubber{position:relative;width:320px;height:64px;touch-action:none}.hill-scrubber-input{position:absolute;inset:0;width:100%;height:64px;box-sizing:border-box;border:0;padding:0;margin:0;opacity:0;pointer-events:none;touch-action:none}.hill-scrubber-art{width:100%;height:64px;pointer-events:none}.hidden{display:none}.hill-scrubber-preview{display:none}</style>`,
      }),
    )
    await page.goto('http://player-fixture.test/')
    await page.addScriptTag({ path: output, type: 'module' })
    const slider = page.locator('.hill-scrubber-input')
    let session: CDPSession | undefined
    let touchActive = false

    try {
      await action(page, 'Start fixture')
      await expect.poll(async () => (await platform(page)).loaded).toBe(true)
      await action(page, 'Pause fixture')
      await action(page, 'Seed position')
      await expect.poll(async () => (await platform(page)).audioTime).toBe(0.75)
      await page.getByRole('button', { name: 'Open scrubber', exact: true }).click()
      await expect
        .poll(async () => (await evidence(page)).some((entry) => entry.kind === 'scrubber-mounted'))
        .toBe(true)
      await action(page, 'Arm Home gate')
      await slider.focus()
      await page.keyboard.press('Home')
      await expect(slider).toHaveValue('0')
      await expect.poll(async () => (await platform(page)).waiting).toBe(true)
      const marker = (await evidence(page)).length
      await action(page, 'Emit current status')
      await expect
        .poll(async () =>
          (await evidence(page))
            .slice(marker)
            .some((entry) => entry.kind === 'ChangedSnapshot' && entry.incomingPosition === 0.75),
        )
        .toBe(true)
      const bounds = await slider.boundingBox()

      if (!bounds) throw new Error('Missing real scrubber')
      session = await page.context().newCDPSession(page)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: bounds.x + bounds.width * (24 / 320), y: bounds.y + 10 }],
      })
      touchActive = true
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: bounds.x + bounds.width * (scenario.move / 320), y: bounds.y + 10 }],
      })
      await expect(slider).toHaveValue('15')
      const observations = (await evidence(page)).slice(marker)
      expect(
        observations.find((entry) => entry.kind === 'pointerdown' && entry.hillTarget),
      ).toMatchObject({
        inputValue: 0,
        modelTime: 0,
        audioTime: 0.75,
      })
      expect(observations.findLast((entry) => entry.kind === 'PreviewedSeek')).toMatchObject({
        seconds: 15,
        referenceSeconds: 0,
      })
      expect((await platform(page)).audioTime).toBe(0.75)
      expect((await platform(page)).seeks.filter((seconds) => seconds === 15)).toHaveLength(0)
      await action(page, 'Release Home')
      await expect.poll(async () => (await platform(page)).audioTime).toBe(0)
      await expect
        .poll(async () => (await evidence(page)).some((entry) => entry.kind === 'CompletedSeek'))
        .toBe(true)
      await expect(slider).toHaveValue('15')
      await session.send('Input.dispatchTouchEvent', {
        type: scenario.resolution === 'commit' ? 'touchEnd' : 'touchCancel',
        touchPoints: [],
      })
      touchActive = false
      const finalTime = scenario.resolution === 'commit' ? 15 : 0
      await expect(slider).toHaveValue(String(finalTime))
      await expect.poll(async () => (await platform(page)).audioTime).toBe(finalTime)
      expect((await platform(page)).seeks.filter((seconds) => seconds === 15)).toHaveLength(
        scenario.resolution === 'commit' ? 1 : 0,
      )
      expect((await platform(page)).paused).toBe(true)
    } finally {
      await info.attach('scalar-home-touch-order', {
        body: (await page.locator('#evidence').textContent()) ?? '[]',
        contentType: 'application/json',
      })

      if (session) {
        if (touchActive)
          await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
        await session.detach()
      }

      await action(page, 'Release Home')
      await page.getByRole('button', { name: 'Dispose fixture', exact: true }).click()
      await expect(page.locator('#app')).toHaveAttribute('data-disposed', 'true')
    }
  })
}
