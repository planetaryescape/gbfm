# Newsletter Subscription Feature

## Signup abuse protection (October 2026)

`POST /api/newsletter/subscribe` requires a Turnstile token. The native Effect UI form loads a
managed widget and forwards its token through the WWW service binding. The API
verifies the token's hostname and `newsletter-subscribe` action before creating a
subscriber or sending mail. Verification failures return 403; provider failures
return 503. Missing tokens return 400. The form requires JavaScript; unsubscribe
forms still work without it.

Current frontend ownership is in [the newsletter Component](../../apps/www/src/features/newsletter/page.ts)
and [SignupChallenge](../../apps/www/src/features/signup-challenge/mount.ts).
The managed mount loads the Turnstile script, owns widget/listener cleanup, and
submits the token with form data to the WWW action using an abortable request.
Do not move tokens into shared query state or add a browser verification bypass.
Token-bearing newsletter links use the standalone credential root described in
[EFFECT-UI.md](../../EFFECT-UI.md), not the routed page cache. This describes the
unmerged, undeployed native conversion, not new production verification.

Alchemy owns `SignupTurnstile`, binds its public sitekey to WWW, and its secret
to the API as a Worker secret. Deployment credentials need account-level Turnstile
edit permission. Production accepts `goosebumps.fm` and `www.goosebumps.fm` tokens.
Local Alchemy development also accepts the configured localhost names. A deployed
preview on another hostname needs that exact hostname added to both the widget
and the API's allowed hostnames before signup will work there.

The API's `SIGNUP_RATE_LIMIT` binding allows five attempts per IP per action per
60 seconds, returning 429 above that limit. WWW forwards Cloudflare's connecting
IP; it does not trust `X-Forwarded-For`. Cloudflare's limiter is an approximate,
per-location abuse guard, not a global quota.

The old application-wide in-memory limiter was removed during the Workers
migration; the migration handover left an edge rule as a separate operational
task. This change does not establish whether that live rule exists. Better Auth
also defaults to production-only in-memory auth limits, but those are local to a
Worker isolate and do not protect the newsletter endpoint.

Account signup (`POST /auth/sign-up/email`) uses the same verifier, with the
`account-signup` action and token supplied in `X-Captcha-Response`. Newsletter
tokens cannot authorize account creation. The two forms have independent rate
counters. This closes the alternate path through account registration's existing
newsletter enrollment hook; it does not change enrollment or email consent rules.

Browser tests use Cloudflare's public test sitekey and an isolated protection
fixture in `local-e2e-server.ts`; production has no verification bypass. No schema
migration is needed. Double opt-in and cleanup of existing subscribers are outside
this change. Password reset and unsubscribe-link requests are not covered by
these new limits; the change does not restore a global API rate limiter.

The sections below describe the original implementation and are historical.
Their React/VPS paths and completion markers are not current frontend guidance.

## Overview

The Newsletter Subscription feature allows visitors to subscribe to the goosebumps newsletter directly through the website. Subscriptions are stored in the VPS database, replacing the previous external Buttondown integration.

## Implementation Status ✅

- **Database Schema**: ✅ Complete (newsletter_subscribers table)
- **API Endpoint**: ✅ Complete (POST /newsletter/subscribe)
- **Frontend UI**: ✅ Complete (React form with loading/success states)
- **Email Sending**: ❌ Not implemented (subscribers stored, no emails sent yet)

## Architecture

### Core Components

- **Database**: PostgreSQL with Drizzle ORM
- **Backend**: Hono.js API with zod-openapi validation
- **Frontend**: React with TanStack Query mutation

## Database Schema

### Newsletter Subscribers Table

```sql
CREATE TABLE newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  source VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX newsletter_subscribers_email_idx ON newsletter_subscribers(email);
```

**Key Fields:**

- `email`: Subscriber's email address (unique, normalized to lowercase)
- `source`: Where the subscription originated (e.g., "subscribe_page")

## API Endpoints

### POST /newsletter/subscribe

Subscribe to the newsletter. Idempotent - returns success even if already subscribed.

**Request Body:**

```json
{
  "email": "user@example.com",
  "source": "subscribe_page"
}
```

**Response (201 Created - new subscription):**

```json
{
  "subscribed": true,
  "email": "user@example.com"
}
```

**Response (200 OK - already subscribed):**

```json
{
  "subscribed": false,
  "email": "user@example.com"
}
```

## File Structure

### Backend (apps/vps)

```
src/
├── db/
│   └── newsletter.schema.ts      # Drizzle schema + zod validators
├── routes/
│   └── newsletter/
│       ├── newsletter.index.ts   # Router setup
│       ├── newsletter.routes.ts  # OpenAPI route definitions
│       └── newsletter.handlers.ts # Request handlers
└── app.ts                        # Route registration
```

### Frontend (apps/www)

```
src/
├── lib/
│   └── http.ts                   # useNewsletterSubscribe hook
└── routes/
    └── subscribe.tsx             # Subscribe page component
```

## Frontend Implementation

The subscribe page (`/subscribe`) features:

- Email input with validation
- Loading state during submission
- Success message differentiating new vs existing subscribers
- Error handling for failed requests

### Usage

```tsx
import { useNewsletterSubscribe } from '@/lib/http'

function SubscribeForm() {
  const { mutate, isPending, isSuccess, data } = useNewsletterSubscribe()

  const handleSubmit = (email: string) => {
    mutate({ email })
  }

  // ...
}
```

## Database Migration

Migration file: `drizzle/0022_wonderful_magik.sql`

Run migration:

```bash
cd apps/vps
bun db:migrate
```

## Future Enhancements

1. **Email Sending**: Integrate with SES to send welcome emails and newsletters
2. **Double Opt-in**: Add email confirmation flow for compliance
3. **Unsubscribe**: Add unsubscribe endpoint and link in emails
4. **Preferences**: Allow subscribers to choose notification types
5. **Admin UI**: Dashboard to view/manage subscribers
