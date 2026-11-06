# Editorial OAuth browser checks

Run from `apps/www`:

```sh
NODE_USE_SYSTEM_CA=1 bun run e2e:mcp
```

The suite uses the existing Portless HTTPS proxy and trusted local CA. It starts an isolated, migrated Miniflare D1 fixture and Vite on dedicated ports 3194 and 5194. No production credentials, accounts or data are used. The reserved routes are `https://gbfm-oauth-onboarding.localhost` and `https://gbfm-oauth-onboarding-api.localhost`; do not run another copy concurrently.

The website and authorization server have separate hostnames and host-only cookies. Tests deliberately authenticate on the website while leaving the API host signed out. Do not collapse those hosts into one origin or disable TLS verification to make the suite pass.

Desktop and tablet use Chromium. The phone viewport uses WebKit. Checks cover:

- Contextual sign-in, wrong-password recovery and keyboard navigation.
- Existing website sessions, including old sign-in continuation URLs.
- Provider-required fresh authentication with `prompt=login` and `max_age=0`.
- Account switching and recovery from an ineligible listener account.
- Signed-in and signed-out cancellation with the original state and no authorization code.
- Invalid signed requests and responsive layout overflow.
- Approval, PKCE token exchange and actual read-only MCP tool discovery.

To capture disposable login and consent screenshots outside git, set `MCP_EVIDENCE_DIR` to an existing absolute directory. Traces and video are disabled because authorization URLs and form submissions contain transient credentials. Do not use real accounts in these fixtures or publish browser state.

The connection screen intentionally keeps the normal password-reset flow separate: after recovery, users are told to start a new connection from their app. It does not put short-lived OAuth queries into reset emails or imply that a newly created listener account has editorial permissions.
