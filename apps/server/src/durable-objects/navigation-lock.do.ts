import { DurableObject } from 'cloudflare:workers'
import { Data } from 'effect'

export type NavigationLockRequestDto = {
  readonly sessionId: string | null
  readonly cursor: number | null
  readonly updatedAtMs: number | null
  readonly intentToken: string
}

export type NavigationLockDecisionDto =
  | { readonly _tag: 'Duplicate'; readonly sessionId: string }
  | { readonly _tag: 'Retry' }
  | { readonly _tag: 'Proceed'; readonly sessionId: string | null; readonly position: number }

const NavigationLockDecisionDto = Data.taggedEnum<NavigationLockDecisionDto>()

export type NavigationLockCommitDto = {
  readonly sessionId: string
  readonly position: number
  readonly intentToken: string
  readonly updatedAtMs: number
}

type IdentityRow = {
  readonly canonicalName: string
  readonly createdAtMs: number
}

type SessionRow = {
  readonly sessionId: string | null
  readonly cursor: number
  readonly updatedAtMs: number | null
  readonly lastIntentToken: string | null
}

type NavigationLockEnv = Record<string, never>

type NavigationLockHeartbeat = {
  readonly canonicalName: string | null
  readonly hasSession: boolean
}

const CREATE_IDENTITY_TABLE = `
  CREATE TABLE IF NOT EXISTS _identity (
    canonical_name TEXT PRIMARY KEY,
    created_at_ms INTEGER NOT NULL
  )
`

const CREATE_SESSION_TABLE = `
  CREATE TABLE IF NOT EXISTS session_state (
    id INTEGER PRIMARY KEY CHECK (id = 0),
    session_id TEXT,
    cursor INTEGER NOT NULL,
    updated_at_ms INTEGER,
    last_intent_token TEXT
  )
`

export class NavigationLockDurableObject extends DurableObject<NavigationLockEnv> {
  constructor(ctx: ConstructorParameters<typeof DurableObject>[0], env: NavigationLockEnv) {
    super(ctx, env)
    void ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(CREATE_IDENTITY_TABLE)
      this.ctx.storage.sql.exec(CREATE_SESSION_TABLE)
    })
  }

  setIdentity(canonicalName: string): IdentityRow {
    const existing = this.getIdentity()

    if (existing) return existing
    const createdAtMs = Date.now()
    this.ctx.storage.sql.exec(
      'INSERT INTO _identity (canonical_name, created_at_ms) VALUES (?, ?)',
      canonicalName,
      createdAtMs,
    )

    return { canonicalName, createdAtMs }
  }

  getIdentity(): IdentityRow | null {
    const row = [
      ...this.ctx.storage.sql.exec<IdentityRow>(
        'SELECT canonical_name as canonicalName, created_at_ms as createdAtMs FROM _identity LIMIT 1',
      ),
    ][0]

    return row ?? null
  }

  private readSession(): SessionRow | null {
    const row = [
      ...this.ctx.storage.sql.exec<SessionRow>(
        'SELECT session_id as sessionId, cursor, updated_at_ms as updatedAtMs, last_intent_token as lastIntentToken FROM session_state WHERE id = 0',
      ),
    ][0]

    return row ?? null
  }

  private writeSession(session: SessionRow): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO session_state (id, session_id, cursor, updated_at_ms, last_intent_token)
       VALUES (0, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         session_id = excluded.session_id,
         cursor = excluded.cursor,
         updated_at_ms = excluded.updated_at_ms,
         last_intent_token = excluded.last_intent_token`,
      session.sessionId,
      session.cursor,
      session.updatedAtMs,
      session.lastIntentToken,
    )
  }

  decide(request: NavigationLockRequestDto): NavigationLockDecisionDto {
    const local = this.readSession()
    // Negative cursors encode pending positions as -(position + 1), keeping committed rows unchanged.
    const cursor = local ? (local.cursor < 0 ? -local.cursor - 1 : local.cursor) : null

    if (
      local &&
      local.cursor >= 0 &&
      local.lastIntentToken === request.intentToken &&
      local.sessionId
    ) {
      return NavigationLockDecisionDto.Duplicate({ sessionId: local.sessionId })
    }

    if (local && (cursor !== request.cursor || local.updatedAtMs !== request.updatedAtMs)) {
      return NavigationLockDecisionDto.Retry()
    }

    const position = (cursor ?? request.cursor ?? -1) + 1
    const sessionId = local?.sessionId ?? request.sessionId
    this.writeSession({
      sessionId,
      cursor: -(position + 1),
      updatedAtMs: request.updatedAtMs,
      lastIntentToken: request.intentToken,
    })

    return NavigationLockDecisionDto.Proceed({ sessionId, position })
  }

  commit(input: NavigationLockCommitDto): void {
    this.ctx.storage.sql.exec(
      `UPDATE session_state SET session_id = ?, cursor = ?, updated_at_ms = ?, last_intent_token = ?
       WHERE id = 0 AND cursor = ? AND last_intent_token = ?`,
      input.sessionId,
      input.position,
      input.updatedAtMs,
      input.intentToken,
      -(input.position + 1),
      input.intentToken,
    )
  }

  sync(input: NavigationLockCommitDto): void {
    this.writeSession({
      sessionId: input.sessionId,
      cursor: input.position,
      updatedAtMs: input.updatedAtMs,
      lastIntentToken: input.intentToken,
    })
  }

  reset(): void {
    this.ctx.storage.sql.exec('DELETE FROM session_state')
  }

  heartbeat(): NavigationLockHeartbeat {
    const identity = this.getIdentity()
    const session = this.readSession()

    return { canonicalName: identity?.canonicalName ?? null, hasSession: session !== null }
  }
}
