import { Schema } from 'effect'

import {
  inspectContentTagMerges,
  mergeContentTags,
  repairMicroTags,
  snapshotContentTagBindings,
} from '../src/db/content-tag-maintenance'
import { makeDatabaseClient } from '../src/db/layer'
import { contentTagGroups } from '../src/lib/content-tags'
import { createRemoteD1, remoteD1OptionsFromEnv } from './remote-d1'

const valueFor = (name: string) =>
  process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3)

const RepairInput = Schema.Struct({
  postId: Schema.String.check(Schema.isUUID()),
  actorId: Schema.NonEmptyString,
  expectedUpdatedAt: Schema.DateFromString,
})

const main = async () => {
  const mode = process.argv[2]
  if (mode !== 'inspect' && mode !== 'merge' && mode !== 'repair')
    throw new Error('Mode must be inspect, merge or repair')

  const environment = valueFor('environment')
  if (environment !== 'production' && environment !== 'staging')
    throw new Error('--environment=production|staging is required')
  if (process.env.D1_ENVIRONMENT !== environment)
    throw new Error('D1_ENVIRONMENT must match --environment')
  const selectedId = process.env.D1_DATABASE_ID
  const expectedId = process.env[`D1_${environment.toUpperCase()}_DATABASE_ID`]
  if (!selectedId || !expectedId || selectedId !== expectedId)
    throw new Error('D1_DATABASE_ID must match the selected environment database')
  if (
    environment === 'staging' &&
    (!process.env.D1_PRODUCTION_DATABASE_ID || selectedId === process.env.D1_PRODUCTION_DATABASE_ID)
  )
    throw new Error('Staging must not select the production database')

  const apply = process.argv.includes('--apply')
  if (apply && mode === 'inspect') throw new Error('Inspect cannot apply changes')
  if (
    apply &&
    environment === 'production' &&
    valueFor('confirm-production') !== 'I_UNDERSTAND_CONTENT_TAG_MAINTENANCE_PRODUCTION'
  )
    throw new Error('Explicit production confirmation is required')

  const db = makeDatabaseClient(createRemoteD1(remoteD1OptionsFromEnv()))
  const before = await inspectContentTagMerges(db)
  const bindings = await snapshotContentTagBindings(db)
  if (bindings.length > 10_000) throw new Error('Tag maintenance exceeds the reviewed row budget')
  if (mode === 'inspect' || !apply)
    return { applied: false, groups: contentTagGroups, counts: before, bindings }

  if (mode === 'merge') {
    await mergeContentTags(db, new Date())
    return { applied: true, before, after: await inspectContentTagMerges(db) }
  }

  const input = Schema.decodeUnknownSync(RepairInput)({
    postId: valueFor('post-id'),
    actorId: valueFor('actor-id'),
    expectedUpdatedAt: valueFor('expected-updated-at'),
  })
  return repairMicroTags(db, { ...input, now: new Date() })
}

main()
  .then((result) => console.log(JSON.stringify(result)))
  .catch(() => {
    console.error('Content tag maintenance failed. No successful outcome is confirmed.')
    process.exitCode = 1
  })
