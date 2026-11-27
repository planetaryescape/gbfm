import { Match } from 'effect'

export type VerificationState = 'pending' | 'verified' | 'failed'

export const verificationState = (url: URL): VerificationState =>
  Match.value({
    failed: url.searchParams.has('error'),
    verified: url.searchParams.has('verified'),
  }).pipe(
    Match.when({ failed: true }, (): VerificationState => 'failed'),
    Match.when({ verified: true }, (): VerificationState => 'verified'),
    Match.orElse((): VerificationState => 'pending'),
  )
