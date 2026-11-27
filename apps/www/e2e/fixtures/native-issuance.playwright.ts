import { readFile } from 'node:fs/promises'

import { test } from '@playwright/test'

// oxlint-disable-next-line import/no-unassigned-import -- Registers the unchanged issuance suite in this isolated fixture runner.
import '../api-key-issuance-runtime.spec'

test.beforeEach(async ({ page }) => {
  const bundle = await readFile(
    process.env.GBFM_ISSUANCE_FIXTURE_BUNDLE ?? '/tmp/opencode/gbfm-native-issuance-fixture.js',
    'utf8',
  )

  await page.route('**/e2e/fixtures/api-key-issuance.ts', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      headers: { 'cache-control': 'no-store' },
      body: bundle,
    }),
  )
})
