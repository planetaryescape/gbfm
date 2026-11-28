import { ListeningDocument } from '@gbfm/api/listening'
import { expect, test } from '@playwright/test'
import { Schema } from 'effect'

import { expectNativeReady } from './fixtures/native-ready'

test.beforeEach(async ({ page }) => {
  await page.goto('/auth/sign-in?returnTo=%2Flistening')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('listener@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Your listening pile', exact: true }),
  ).toBeVisible()
  await expectNativeReady(page)
})

test('listeners capture privately, annotate, collect, publish and unpublish without exposing drafts', async ({
  page,
  browser,
}) => {
  const suffix = crypto.randomUUID()
  const title = `Listening fixture ${suffix}`
  const collectionName = `Night selections ${suffix}`

  const submit = async (operation: string, buttonName: string) => {
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/actions/listening/${operation}`) && response.status() === 303,
      ),
      page.getByRole('button', { name: buttonName, exact: true }).click(),
    ])
    await page.waitForLoadState('load')
    await expectNativeReady(page)
  }

  await page.locator('summary').filter({ hasText: '+ New collection' }).click()
  await page.getByRole('textbox', { name: 'Collection name', exact: true }).fill(collectionName)
  await page.getByRole('checkbox', { name: 'Make collection public', exact: true }).check()
  await submit('create-collection', 'Create collection')
  await expect(
    page.getByRole('link', { name: `${collectionName} · public`, exact: true }),
  ).toBeVisible()

  await page.locator('summary').filter({ hasText: '+ Add mixes' }).click()
  await page
    .getByRole('textbox', { name: 'Mix or public playlist URL', exact: true })
    .fill(`https://soundcloud.com/local-fixture/mix-${suffix}`)
  await page.getByRole('button', { name: 'Preview import', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Import preview · 1 mixes', exact: true }),
  ).toBeVisible()
  await expectNativeReady(page)
  await submit('save-import', 'Save selected mixes privately')
  await page
    .getByRole('link')
    .filter({ hasText: `mix-${suffix}` })
    .click()
  const editor = page.getByRole('complementary', { name: 'Mix notes', exact: true })
  await expect(editor).toContainText('Private draft')
  const selectedMix = new URL(page.url()).searchParams.get('mix')
  expect(selectedMix).toBeTruthy()
  await expect(editor.locator('form[action$="edit-mix"] input[name="id"]')).toHaveValue(
    selectedMix ?? '',
  )
  await editor.getByRole('textbox', { name: 'Mix title', exact: true }).fill(title)
  await editor
    .getByRole('textbox', { name: 'Listening notes', exact: true })
    .fill('Private thought: the transition at 14:20 makes this set.')
  await editor
    .getByRole('combobox', { name: 'Listening status', exact: true })
    .selectOption('listening')
  await submit('edit-mix', 'Save notes & status')
  expect(new URL(page.url()).searchParams.get('mix')).toBe(selectedMix)
  await expect(editor.getByRole('textbox', { name: 'Mix title' })).toHaveValue(title)

  const listeningStatus = page
    .getByRole('navigation', { name: 'Listening status', exact: true })
    .getByRole('link', { name: 'Listening', exact: true })

  await expect(listeningStatus).toHaveCount(1)
  await expect(listeningStatus).toHaveAttribute('href', '/listening?status=listening')
  await listeningStatus.click()
  await expect(page).toHaveURL(/\/listening\?status=listening$/)
  await page.getByRole('link').filter({ hasText: title }).click()
  await expect(editor.getByRole('textbox', { name: 'Mix title' })).toHaveValue(title)
  await editor.locator('summary').filter({ hasText: 'Collections & more' }).click()
  await submit('membership', `+ Add to ${collectionName}`)
  await expect(editor.getByRole('textbox', { name: 'Mix title' })).toHaveValue(title)

  await page.getByRole('link', { name: `${collectionName} · public`, exact: true }).click()
  await page.locator('summary').filter({ hasText: 'Collection settings' }).click()

  const publicPath = await page
    .getByRole('link', { name: 'View public collection ↗', exact: true })
    .getAttribute('href')

  if (!publicPath) throw new Error('Public collection link missing')
  await page.getByRole('link').filter({ hasText: title }).click()
  const anonymous = await browser.newContext()

  try {
    const publicPage = await anonymous.newPage()
    await publicPage.goto(new URL(publicPath, page.url()).href)
    await expect(
      publicPage.getByRole('heading', { name: collectionName, exact: true }),
    ).toBeVisible()
    await expect(
      publicPage.getByText('No published mixes in this collection yet.', { exact: true }),
    ).toBeVisible()
    await expect(publicPage.locator('body')).not.toContainText('Private thought')

    await editor
      .getByRole('checkbox', { name: 'Publish this mix and its notes', exact: true })
      .check()
    await submit('edit-mix', 'Save notes & status')
    await expect(editor).toContainText('Published')
    await publicPage.reload()
    await expect(publicPage.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(publicPage.locator('article')).toContainText(
      'Private thought: the transition at 14:20 makes this set.',
    )
    await expect(
      publicPage.getByRole('link', { name: 'Open on original platform ↗', exact: true }),
    ).toHaveAttribute('href', `https://soundcloud.com/local-fixture/mix-${suffix}`)

    await editor
      .getByRole('checkbox', { name: 'Publish this mix and its notes', exact: true })
      .uncheck()
    await submit('edit-mix', 'Save notes & status')
    await expect(editor).toContainText('Private draft')
    await publicPage.reload()
    await expect(publicPage.locator('body')).not.toContainText('Private thought')
  } finally {
    await anonymous.close()
  }
})

test('switching collections discards the previous collection’s unsaved settings', async ({
  page,
}) => {
  const suffix = crypto.randomUUID()
  const titles = [`Collection A ${suffix}`, `Collection B ${suffix}`] as const

  for (const title of titles) {
    const response = await page.request.post('/api/listening/collections', {
      data: { title, description: `Description for ${title}`, published: false },
    })

    await expect(response).toBeOK()
  }

  const document = Schema.decodeUnknownSync(ListeningDocument)(
    await (await page.request.get('/api/listening')).json(),
  )

  const collections = document.collections.filter((collection) =>
    titles.some((title) => title === collection.title),
  )

  expect(collections).toHaveLength(2)

  for (const collection of collections) expect(collection.version).toBe('revision:1')

  const selectedCollection = collections.find((collection) => collection.title === titles[1])

  if (!selectedCollection) throw new Error('The second fixture collection must exist')

  try {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/listening')
    await expectNativeReady(page)
    await page.getByRole('link', { name: `${titles[0]} · private`, exact: true }).click()
    await page.locator('summary').filter({ hasText: 'Collection settings' }).click()
    const form = page.locator('form[action$="edit-collection"]')
    await form
      .getByRole('textbox', { name: 'Collection name', exact: true })
      .fill('Unsaved A title')
    await form
      .getByRole('textbox', { name: 'Description', exact: true })
      .fill('Unsaved A description')
    await form.getByRole('checkbox', { name: 'Make collection public', exact: true }).check()
    await page.getByRole('link', { name: `${titles[1]} · private`, exact: true }).click()
    await expect(form.locator('input[name="id"]')).toHaveValue(
      collections.find((collection) => collection.title === titles[1])?.id ?? '',
    )

    const settings = page
      .locator('details')
      .filter({ has: page.locator('form[action$="edit-collection"]') })

    if ((await settings.getAttribute('open')) === null) await settings.locator('summary').click()
    await expect(form.getByRole('textbox', { name: 'Collection name', exact: true })).toHaveValue(
      titles[1],
    )
    await expect(form.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
      `Description for ${titles[1]}`,
    )
    await expect(
      form.getByRole('checkbox', { name: 'Make collection public', exact: true }),
    ).not.toBeChecked()
    await expect(form.locator('input[name="expectedVersion"]')).toHaveValue('revision:1')
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/actions/listening/edit-collection') &&
          response.status() === 303,
      ),
      form.getByRole('button', { name: 'Save collection', exact: true }).click(),
    ])

    const saved = Schema.decodeUnknownSync(ListeningDocument)(
      await (await page.request.get('/api/listening')).json(),
    )

    for (const collection of collections) {
      const expected =
        collection.id === selectedCollection.id
          ? { ...collection, version: 'revision:2' }
          : collection

      expect(saved.collections.find((item) => item.id === collection.id)).toEqual(expected)
    }
  } finally {
    for (const collection of collections) {
      await page.request.delete(`/api/listening/collections/${collection.id}`)
    }
  }
})

test('selecting a lower queue row reveals its notes without another interaction', async ({
  page,
}) => {
  const suffix = crypto.randomUUID()

  const response = await page.request.post('/api/listening/mixes', {
    data: {
      items: Array.from({ length: 24 }, (_, index) => ({
        url: `https://soundcloud.com/queue-regression-${suffix}/mix-${index}`,
        title: `Queue regression ${suffix} ${index}`,
      })),
    },
  })

  await expect(response).toBeOK()

  const document = Schema.decodeUnknownSync(ListeningDocument)(
    await (await page.request.get('/api/listening')).json(),
  )

  const mixes = document.mixes.filter((mix) => mix.title.startsWith(`Queue regression ${suffix}`))

  try {
    await page.goto('/listening')
    await expectNativeReady(page)

    const row = page
      .getByRole('link')
      .filter({ hasText: `Queue regression ${suffix}` })
      .last()

    await row.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(1000)
    await row.click()
    await expect(page).toHaveURL(/mix=.*#mix-notes$/)
    const editor = page.getByRole('complementary', { name: 'Mix notes', exact: true })
    await expect(
      editor.getByRole('link', { name: '← Back to queue', exact: true }),
    ).toBeInViewport()
    await expect(editor.getByRole('textbox', { name: 'Mix title', exact: true })).toBeInViewport()
  } finally {
    for (const mix of mixes) {
      await page.request.delete(`/api/listening/mixes/${mix.id}`)
    }
  }
})
