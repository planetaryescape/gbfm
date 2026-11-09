import { parseArgs } from 'node:util'

import { McpScope } from '@gbfm/core/editorial-mcp'
import { Context, Effect, Layer, Result, Schema } from 'effect'

import { Database, DatabaseLayer } from '../src/db/layer'
import {
  applyMcpPolicy,
  inspectMcpPolicy,
  McpPolicyError,
  planMcpPolicy,
  planMcpPolicyRollback,
  PolicyPlan,
  PolicyTarget,
} from '../src/services/mcp-resource-policy'
import { createRemoteD1, remoteD1OptionsFromEnv } from './remote-d1'

const program = Effect.gen(function* () {
  const { values, positionals } = yield* Effect.try({
    try: () =>
      parseArgs({
        args: process.argv.slice(2),
        allowPositionals: true,
        strict: true,
        options: {
          environment: { type: 'string' },
          resource: { type: 'string' },
          scopes: { type: 'string' },
          'expected-version': { type: 'string' },
          actor: { type: 'string' },
          reason: { type: 'string' },
          approval: { type: 'string' },
          'operation-id': { type: 'string' },
          'rollback-operation-id': { type: 'string' },
          plan: { type: 'string' },
          'confirm-resource': { type: 'string' },
        },
      }),
    catch: () => new McpPolicyError({ reason: 'invalid_plan' }),
  })

  const [mode] = positionals

  if (
    positionals.length !== 1 ||
    !['inspect', 'plan', 'rollback-plan', 'apply'].includes(mode ?? '')
  )
    return yield* new McpPolicyError({ reason: 'invalid_plan' })

  const target = yield* Schema.decodeUnknownEffect(PolicyTarget)({
    environment: values.environment,
    databaseId: process.env.D1_DATABASE_ID,
    resourceUrl: values.resource,
  }).pipe(Effect.mapError(() => new McpPolicyError({ reason: 'target_mismatch' })))

  const expectedDatabase = process.env[`D1_${target.environment.toUpperCase()}_DATABASE_ID`]
  const productionDatabase = process.env.D1_PRODUCTION_DATABASE_ID

  if (
    process.env.D1_ENVIRONMENT !== target.environment ||
    !expectedDatabase ||
    target.databaseId !== expectedDatabase ||
    !productionDatabase ||
    (target.environment !== 'production' && target.databaseId === productionDatabase) ||
    (target.environment === 'production' &&
      target.resourceUrl !== 'https://api.goosebumps.fm/mcp') ||
    (target.environment !== 'production' &&
      new URL(target.resourceUrl).hostname === 'api.goosebumps.fm')
  )
    return yield* new McpPolicyError({ reason: 'target_mismatch' })

  const operation = Effect.gen(function* () {
    if (mode === 'inspect') return yield* inspectMcpPolicy(target)

    if (mode === 'apply') {
      if (!values.plan || values['confirm-resource'] !== target.resourceUrl)
        return yield* new McpPolicyError({ reason: 'invalid_plan' })

      const raw = yield* Effect.tryPromise({
        try: async () => {
          const file = Bun.file(values.plan ?? '')

          if (file.size > 65536) throw new Error('Plan too large')

          return JSON.parse(await file.text())
        },
        catch: () => new McpPolicyError({ reason: 'invalid_plan' }),
      })

      const plan = yield* Schema.decodeUnknownEffect(PolicyPlan)(raw, {
        onExcessProperty: 'error',
      }).pipe(Effect.mapError(() => new McpPolicyError({ reason: 'invalid_plan' })))

      return yield* applyMcpPolicy(target, plan)
    }

    const input = {
      operationId: values['operation-id'] ?? crypto.randomUUID(),
      target,
      actor: values.actor ?? '',
      reason: values.reason ?? '',
      approval: values.approval ?? '',
      expectedVersion: Number(values['expected-version']),
    }

    if (mode === 'rollback-plan')
      return yield* planMcpPolicyRollback({
        ...input,
        rollbackOperationId: values['rollback-operation-id'] ?? '',
      })

    const scopes = yield* Schema.decodeUnknownEffect(Schema.Array(McpScope))(
      values.scopes?.split(/\s+/).filter(Boolean),
    ).pipe(Effect.mapError(() => new McpPolicyError({ reason: 'invalid_plan' })))

    return yield* planMcpPolicy({ ...input, scopes })
  })

  const options = yield* Effect.try({
    try: remoteD1OptionsFromEnv,
    catch: () => new McpPolicyError({ reason: 'unavailable' }),
  })

  return { operation, options }
})

const reportError = (error: McpPolicyError) => {
  process.stderr.write(`${JSON.stringify({ error: error._tag, reason: error.reason })}\n`)
  process.exitCode = 1
}

const invocation = await Effect.runPromise(program.pipe(Effect.result))

if (Result.isFailure(invocation)) reportError(invocation.failure)
else {
  const { operation, options } = invocation.success

  await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.build(DatabaseLayer(createRemoteD1(options)))

      return yield* operation.pipe(Effect.provideService(Database, Context.get(context, Database)))
    }).pipe(
      Effect.scoped,
      Effect.match({
        onFailure: reportError,
        onSuccess: (result) => {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
        },
      }),
    ),
  )
}
