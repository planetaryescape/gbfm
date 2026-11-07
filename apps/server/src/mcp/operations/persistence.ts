import type { D1Database } from '@cloudflare/workers-types'
import type { SQL } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { Schema } from 'effect'

import type { JsonValue, OperationKey } from './store'

const dialect = new SQLiteSyncDialect()

const encoder = new TextEncoder()

const decodeJson = Schema.decodeUnknownSync(Schema.Json)

const decodeBindings = Schema.decodeUnknownSync(
  Schema.Array(Schema.Union([Schema.Null, Schema.String, Schema.Number, Schema.Boolean])),
)

/** Internal canonical representation shared by atomic and staged receipt adapters. */
export const canonicalJson = (value: JsonValue): string => {
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJson).join(',')}]`

  if (Schema.is(Schema.JsonObject)(value))
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`

  return JSON.stringify(decodeJson(value))
}

/** Internal digest, never a substitute for live scoped authorization. */
export const digest = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

/** Internal SQL binding adapter; accepts only D1's scalar representations. */
export const prepareOperationStatement = (database: D1Database, statement: SQL) => {
  const query = dialect.sqlToQuery(statement)

  const bindings = decodeBindings(query.params).map((value) =>
    Schema.is(Schema.Boolean)(value) ? Number(value) : value,
  )

  return database.prepare(query.sql).bind(...bindings)
}

/** Internal stable receipt identity. Browser/PAT/OAuth callers all use the same tuple. */
export const operationIdentity = async (key: OperationKey, normalizedInput: JsonValue) => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key.requestId) ||
    [key.actorId, key.clientId, key.resource, key.operation].some(
      (part) => !Schema.is(Schema.String)(part) || part.length === 0 || part.length > 2048,
    )
  )
    throw new Error('Invalid operation key')
  const normalized = canonicalJson(normalizedInput)

  if (encoder.encode(normalized).length > 262144) throw new Error('Invalid operation input')

  return {
    operationId: await digest(
      canonicalJson([
        key.actorId,
        key.clientId,
        key.resource,
        key.operation,
        key.requestId.toLowerCase(),
      ]),
    ),
    inputHash: await digest(normalized),
  }
}
