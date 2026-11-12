import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createD1MigrationTemplate } from './migrate-d1'

export default async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gbfm-d1-template-'))
  const previousTemplate = process.env.GBFM_D1_TEST_TEMPLATE

  try {
    await createD1MigrationTemplate(directory)
    process.env.GBFM_D1_TEST_TEMPLATE = directory
  } catch (cause) {
    await rm(directory, { recursive: true, force: true })
    throw cause
  }

  return async () => {
    if (previousTemplate === undefined) delete process.env.GBFM_D1_TEST_TEMPLATE
    else process.env.GBFM_D1_TEST_TEMPLATE = previousTemplate
    await rm(directory, { recursive: true, force: true })
  }
}
