import { AuthSession } from '@gbfm/api/middleware/auth'
import { Effect } from 'effect'

import { makeSessionCommandAuthority } from '@/mcp/command-authority'
import { ConfigService, createConfig } from '@/services/config.service'

/** Domain fixtures use real persisted session guards, not a substitute OAuth grant. */
export const listeningTestSessionAuthority = (userId: string) =>
  makeSessionCommandAuthority.pipe(
    Effect.provideService(AuthSession, {
      user: { id: userId, name: userId, email: `${userId}@example.test` },
      session: { id: `${userId}-session`, createdAt: new Date(0) },
    }),
    Effect.provideService(ConfigService, createConfig()),
  )
