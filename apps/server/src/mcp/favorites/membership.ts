import { sql, type SQL } from 'drizzle-orm'
import { Schema } from 'effect'

import { audioTable } from '@/db/audio.schema'
import { user } from '@/db/auth.schema'
import { favoritesTable } from '@/db/favorites.schema'
import type { DatabaseClient } from '@/db/layer'
import { listenerMembershipRevisions } from '@/db/listening.schema'
import { showSubscriptionsTable, showsTable } from '@/db/show.schema'

import type {
  McpOperationStore,
  OperationKey,
  OperationOutcome,
  OperationResult,
} from '../operations/store'
import { SetFavoriteInput } from './contracts'

export interface MembershipWriteContext extends MembershipAuthority {
  readonly requestId: string
  readonly expectedRevision: number
}

/** Supplied by authenticated composition, never decoded from a command payload. */
export interface MembershipAuthority {
  readonly actorId: string
  readonly clientId: string
  readonly resource: string
  readonly now: number
  readonly authorize: (outcome?: OperationOutcome) => Promise<boolean>
  /** Live credential/scopes predicate evaluated inside the same D1 transaction. */
  readonly live: SQL
}

/** Owner-wide CAS and coupled-write plan used by the membership service writers. */
export const executeMembership = async (
  db: DatabaseClient,
  store: Pick<typeof McpOperationStore.Service, 'execute'>,
  authority: MembershipAuthority,
  operation: 'favorite' | 'subscription',
  input: typeof SetFavoriteInput.Type,
): Promise<OperationResult> => {
  if (
    !Schema.is(SetFavoriteInput)(input) ||
    (operation === 'subscription' && input.targetKind !== 'show') ||
    input.expectedRevision === Number.MAX_SAFE_INTEGER
  )
    return { status: 'invalid_input' }

  const { actorId, clientId, resource, now } = authority
  const { targetId, targetKind, desiredState, expectedRevision } = input
  const requestId = input.requestId.toLowerCase()
  const revision = expectedRevision + 1
  const target = targetKind === 'audio' ? audioTable : showsTable

  const live = sql`${authority.live}
    AND EXISTS (SELECT 1 FROM ${user} WHERE ${user.id} = ${actorId} AND ${user.banned} = 0)
    AND EXISTS (SELECT 1 FROM ${target} WHERE ${target.id} = ${targetId} AND ${target.draft} = 0)`

  const key: OperationKey = {
    actorId,
    clientId,
    resource,
    operation: operation === 'favorite' ? 'set_favorite' : 'set_show_subscription',
    requestId,
  }

  const favoriteTarget =
    targetKind === 'audio'
      ? sql`${favoritesTable.audioId} = ${targetId} AND ${favoritesTable.showId} IS NULL`
      : sql`${favoritesTable.showId} = ${targetId} AND ${favoritesTable.audioId} IS NULL`

  return store.execute({
    key,
    now,
    normalizedInput: { targetKind, targetId, desiredState, expectedRevision },
    authorize: async (outcome) =>
      (await authority.authorize(outcome)) &&
      (await db.all(sql`SELECT 1 WHERE ${live}`)).length > 0,
    build: ({ attemptId, operationId, fence, prepare }) => {
      const winner = sql`EXISTS (SELECT 1 FROM ${listenerMembershipRevisions}
        WHERE ${listenerMembershipRevisions.userId} = ${actorId}
          AND ${listenerMembershipRevisions.revision} = ${revision}
          AND ${listenerMembershipRevisions.lastTransitionId} = ${attemptId})`

      const guard = sql`${fence} AND ${winner} AND ${live}`

      const statements = [
        prepare(sql`INSERT INTO ${listenerMembershipRevisions} (user_id,revision,last_transition_id)
          SELECT ${actorId},0,NULL WHERE ${fence} AND ${live}
          ON CONFLICT(user_id) DO NOTHING`),
        prepare(sql`UPDATE ${listenerMembershipRevisions}
          SET revision = ${revision}, last_transition_id = ${attemptId}
          WHERE user_id = ${actorId} AND revision = ${expectedRevision} AND ${fence} AND ${live}`),
      ]

      // Unsubscribing retains the favorite. Favoriting a show couples both memberships.
      if (operation === 'favorite' || desiredState) {
        statements.push(
          desiredState
            ? prepare(sql`INSERT INTO ${favoritesTable} (id,user_id,audio_id,show_id,created_at)
                SELECT ${attemptId},${actorId},${targetKind === 'audio' ? targetId : null},
                  ${targetKind === 'show' ? targetId : null},${now} WHERE ${guard}
                ON CONFLICT DO NOTHING`)
            : prepare(sql`DELETE FROM ${favoritesTable}
                WHERE user_id = ${actorId} AND ${favoriteTarget} AND ${guard}`),
        )
      }

      if (targetKind === 'show') {
        statements.push(
          desiredState
            ? prepare(sql`INSERT INTO ${showSubscriptionsTable} (id,userId,showId,createdAt)
                SELECT ${attemptId},${actorId},${targetId},${now} WHERE ${guard}
                ON CONFLICT DO NOTHING`)
            : prepare(sql`DELETE FROM ${showSubscriptionsTable}
                WHERE ${showSubscriptionsTable.userId} = ${actorId}
                  AND ${showSubscriptionsTable.showId} = ${targetId} AND ${guard}`),
        )
      }

      const favoriteMatches =
        operation === 'subscription' && !desiredState
          ? sql`1`
          : sql`EXISTS (SELECT 1 FROM ${favoritesTable}
              WHERE user_id = ${actorId} AND ${favoriteTarget}) = ${Number(desiredState)}`

      const subscriptionMatches =
        targetKind === 'audio'
          ? sql`1`
          : sql`EXISTS (SELECT 1 FROM ${showSubscriptionsTable}
              WHERE ${showSubscriptionsTable.userId} = ${actorId}
                AND ${showSubscriptionsTable.showId} = ${targetId}) = ${Number(desiredState)}`

      return {
        statements,
        assertApplied: sql`${fence} AND ${winner} AND ${live} AND ${favoriteMatches} AND ${subscriptionMatches}`,
        outcome: {
          result: {
            requestId,
            operationId,
            targetKind,
            targetId,
            desiredState,
            revision,
            notifications: 'not_sent',
          },
          revision,
          access: { actorId, targetKind, targetId },
        },
      }
    },
  })
}
