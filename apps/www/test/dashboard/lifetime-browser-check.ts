import { chromium, devices, expect } from '@playwright/test'
import { build } from 'bun'

const red = process.env.DASHBOARD_BOUNDARY_RED ?? ''
const capturedPath = process.env.GBFM_DASHBOARD_CAPTURED_NOJS_HTML

if (!capturedPath)
  throw new Error(
    'Six-boundary proof requires GBFM_DASHBOARD_CAPTURED_NOJS_HTML with the captured full-page no-JS fixture. A synthetic table without navigation cannot prove the footer regression.',
  )

const capturedHtml = await Bun.file(capturedPath).text()

const result = await build({
  entrypoints: [new URL('./lifetime-browser-fixture.ts', import.meta.url).pathname],
  target: 'browser',
  plugins:
    red === 'import' || red === 'sessions' || red === 'dates'
      ? [
          {
            name: 'original-unkeyed-boundaries',
            setup: (builder) => {
              builder.onLoad(
                { filter: /(?:library-view|sessions|email-history-view)\.ts$/ },
                async ({ path }) => ({
                  contents: (await Bun.file(path).text())
                    .replace(
                      red === 'sessions' ? ".key('selected-user')" : '__no_session_change__',
                      '',
                    )
                    .replace(red === 'import' ? ".key('library-list')" : '__no_import_change__', '')
                    .replace(
                      red === 'dates'
                        ? "h.span(`${dateFrom || 'Start'} to ${dateTo || 'today'}`)"
                        : '__no_date_change__',
                      "`${dateFrom || 'Start'} to ${dateTo || 'today'}`",
                    ),
                  loader: 'ts',
                }),
              )
            },
          },
        ]
      : [],
})

if (!result.success || !result.outputs[0]) throw new Error('Boundary fixture bundle failed')

const bundle = await result.outputs[0].text()

const css = await Bun.file(
  new URL('../../src/features/dashboard/native.css', import.meta.url),
).text()

const styles = new Bun.Glob('client/assets/*.css')

const dist = new URL('../../dist/', import.meta.url).pathname

const baseCss = (
  await Promise.all(Array.from(styles.scanSync(dist), (path) => Bun.file(`${dist}${path}`).text()))
).join('\n')

if (!baseCss) throw new Error('Build CSS required for representative table geometry')

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? Bun.which('chromium') ?? undefined,
  headless: true,
})

const context = await browser.newContext({
  ...devices['Pixel 5'],
  baseURL: 'https://dashboard-boundary.test',
})

const page = await context.newPage()

page.setDefaultTimeout(8000)

const evidence: Array<object> = []

try {
  page.on('pageerror', (error) => process.stderr.write(`${error.message}\n`))
  await page.route('https://dashboard-boundary.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname

    if (path.startsWith('/fonts/'))
      return route.fulfill({
        body: Buffer.from(await Bun.file(`${dist}client${path}`).arrayBuffer()),
        contentType: 'font/woff2',
      })

    return route.fulfill({
      contentType: 'text/html',
      body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div class="gbfm-dashboard"><main class="dashboard-content" style="width:393px;padding:16px"><div id="app"></div></main></div><style>body{margin:0}*{box-sizing:border-box}</style>',
    })
  })

  const open = async (section: string) => {
    await page.goto(`/?section=${section}`)
    await page.addStyleTag({
      content:
        baseCss +
        (red === section
          ? css.replace(/\.gbfm-dashboard \.admin-table td\.dashboard-actions-cell \{[^}]*\}/, '')
          : css),
    })
    await page.addScriptTag({ content: bundle, type: 'module' })
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
    await page.waitForFunction(() => document.fonts.status === 'loaded')
  }

  const geometry = async (name: string) => {
    const table = page.getByRole('table', { name, exact: true })

    const measured = await table.evaluate((node) => ({
      documentWidth: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      table: node.getBoundingClientRect().width,
      wrapper: node.parentElement?.clientWidth,
      scroll: node.parentElement?.scrollLeft,
      actionWhiteSpace: getComputedStyle(node.querySelector('.dashboard-actions-cell') ?? node)
        .whiteSpace,
      documentScroll: scrollX,
      visualOffset: visualViewport?.offsetLeft,
    }))

    expect(measured.documentWidth).toBeLessThanOrEqual(measured.viewport)
    expect(measured.viewport).toBe(393)
    expect(measured.wrapper).toBe(361)
    expect(measured.table).toBeGreaterThanOrEqual(576)
    expect(measured.scroll).toBeGreaterThan(0)
    expect(measured.actionWhiteSpace).toBe('normal')
    expect(measured.documentScroll).toBe(0)
    expect(measured.visualOffset).toBe(0)

    return measured
  }

  await open('playlists')
  await page
    .locator('summary')
    .filter({ hasText: /^Import from Spotify$/ })
    .click()
  const input = page.getByRole('textbox', { name: 'Spotify playlist URL', exact: true })
  await input.fill('https://example.test/invalid')
  const originalInput = await input.elementHandle()

  if (!originalInput) throw new Error('Import input missing')
  await page.getByRole('button', { name: 'Import playlist', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Enter an https://open.spotify.com/playlist/')
  expect(
    await originalInput.evaluate((node) => node.isConnected),
    'validation retains native disclosure and input identity',
  ).toBe(true)
  await expect(input).toBeVisible()
  await input.fill('https://open.spotify.com/playlist/valid')
  await expect(input).toHaveValue('https://open.spotify.com/playlist/valid')
  evidence.push({
    boundary: 'import validation',
    retainedInput: true,
    visibleAndEditable: true,
    writes: await page.locator('body').getAttribute('data-writes'),
  })

  await open('shows')
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirm delete', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Keep show', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirm delete', exact: true })).toHaveCount(0)
  evidence.push({
    boundary: 'show delete',
    ordinaryClickAndCancel: true,
    geometry: await geometry('Shows'),
  })

  await open('playlists')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Playlist tracks' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove Bravo', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-writes', '1')
  evidence.push({
    boundary: 'track remove',
    ordinaryClickReachesService: true,
    geometry: await geometry('Playlist tracks'),
  })

  const noScriptCss =
    red === 'users' ? css.replace(/@media \(scripting: none\) \{[^}]*\}\s*\}/, '') : css

  const noScript = await browser.newContext({ ...devices['Pixel 5'], javaScriptEnabled: false })

  try {
    const staticPage = await noScript.newPage()
    staticPage.setDefaultTimeout(8000)
    await staticPage.route('https://dashboard-static.test/**', async (route) => {
      const path = new URL(route.request().url()).pathname

      if (path.startsWith('/fonts/'))
        return route.fulfill({
          body: Buffer.from(await Bun.file(`${dist}client${path}`).arrayBuffer()),
          contentType: 'font/woff2',
        })

      if (path.startsWith('/assets/'))
        return route.fulfill({
          body: Buffer.from(await Bun.file(`${dist}client${path}`).arrayBuffer()),
          contentType: path.endsWith('.css') ? 'text/css' : 'text/javascript',
        })

      return route.fulfill({
        contentType: 'text/html',
        body: capturedHtml.replace('</head>', `<style>${noScriptCss}</style></head>`),
      })
    })
    await staticPage.goto('https://dashboard-static.test/')
    await staticPage.waitForFunction(() => document.fonts.status === 'loaded')
    await staticPage
      .locator('summary')
      .filter({ hasText: /^More$/ })
      .click()
    await staticPage
      .locator('summary')
      .filter({ hasText: /^Delete$/ })
      .click()
    await expect(
      staticPage.getByRole('button', { name: 'Confirm delete', exact: true }),
    ).toBeVisible()
    await staticPage
      .getByRole('button', { name: 'Confirm delete', exact: true })
      .click({ trial: true })
    evidence.push({
      boundary: 'no-JS user delete',
      capturedFullPage: true,
      ordinaryDisclosureAndActionReachable: true,
    })
  } finally {
    await noScript.close()
  }

  await open('dates')
  await expect(page.getByText('2026-09-26 to 2026-09-26', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Clear dates', exact: true })).toHaveAttribute(
    'href',
    '/dashboard/email-logs',
  )
  evidence.push({ boundary: 'date label', exactLabelAndClearDatesRetained: true })

  let searches = 0
  await page.route('**/auth/admin/list-users**', async (route) => {
    searches++

    if (searches === 2) {
      await page.evaluate(() => {
        document.body.dataset.searchWaiting = 'true'
      })
      await expect(page.locator('body')).toHaveAttribute('data-release-search', 'true')
    }

    await route.fulfill({
      json: { users: [{ id: 'user', name: 'Fixture', email: 'user@example.test' }] },
    })
  })
  await page.route('**/auth/admin/list-user-sessions', (route) =>
    route.fulfill({
      json: {
        sessions: [
          {
            id: 'session',
            userId: 'user',
            token: 'synthetic-not-a-secret',
            createdAt: '2026-01-01T00:00:00Z',
            expiresAt: '2026-12-01T00:00:00Z',
            userAgent: 'Fixture session',
            ipAddress: null,
          },
        ],
      },
    }),
  )
  await open('sessions')
  await page.getByRole('searchbox').fill('user@example.test')
  await page.getByRole('button', { name: 'Search users', exact: true }).click()
  await page.getByRole('button', { name: 'View sessions for user@example.test' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-search-waiting', 'true')
  const table = page.getByRole('table', { name: 'Active sessions' })
  await expect(table).toBeVisible()
  const originalTable = await table.elementHandle()

  if (!originalTable) throw new Error('Session table missing')
  await page.locator('body').evaluate((node) => {
    node.dataset.releaseSearch = 'true'
  })
  await expect(
    page.getByRole('button', { name: 'View sessions for user@example.test' }),
  ).toBeVisible()
  await table.scrollIntoViewIfNeeded()
  expect(
    await originalTable.evaluate((node) => node.isConnected),
    'user result refresh retains the selected session DOM',
  ).toBe(true)
  evidence.push({ boundary: 'session table identity', searches, sameTableAfterUserQuery: true })
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await context.close()
  await browser.close()
}
