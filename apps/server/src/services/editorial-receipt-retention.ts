import { EDITORIAL_DRAFT_RETRY_WINDOW_MS } from '@gbfm/core/editorial-mcp'
import { and, asc, inArray, isNotNull, lte } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { editorialOperations } from '@/db/editorial-operation.schema'
import { Database } from '@/db/layer'
import { DatabaseError } from '@/errors'

export const expireEditorialReceipts = Effect.fn('EditorialReceipts.expire')(function* () {
  const db = yield* Database
  const cutoff = new Date((yield* Clock.currentTimeMillis) - EDITORIAL_DRAFT_RETRY_WINDOW_MS)
  let expired = 0

  for (let batch = 0; batch < 10; batch++) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .update(editorialOperations)
          .set({ result: null })
          .where(
            inArray(
              editorialOperations.id,
              db
                .select({ id: editorialOperations.id })
                .from(editorialOperations)
                .where(
                  and(
                    isNotNull(editorialOperations.result),
                    lte(editorialOperations.createdAt, cutoff),
                  ),
                )
                .orderBy(asc(editorialOperations.createdAt))
                .limit(100),
            ),
          )
          .returning({ id: editorialOperations.id }),
      catch: () =>
        new DatabaseError({
          message: 'Failed to expire editorial save receipts',
          operation: 'update',
          table: 'editorial_operations',
        }),
    })

    expired += rows.length

    if (rows.length < 100) break
  }

  return { expired }
})
