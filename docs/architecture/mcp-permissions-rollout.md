# MCP permissions rollout and connection upgrades

Deploying a tool, registering a client and approving a user connection are three
different permissions gates. A code deployment must not silently widen the
persisted `oauth_resource.allowed_scopes` policy. New tools stay unavailable until
an operator explicitly enables their scopes in that environment.

## Operator workflow

Use `bun --cwd apps/server run mcp:policy`. This is an operator command, not a
public endpoint or an MCP tool. It uses the existing remote D1 adapter and the
operator's Cloudflare credentials supplied through the environment. Never put
credentials in command arguments, plans, approval references or logs.

Required environment variables:

- `CLOUDFLARE_ACCOUNT_ID` (or `CLOUDFLARE_DEFAULT_ACCOUNT_ID`) and
  `CLOUDFLARE_API_TOKEN`, supplied through the existing secure environment flow.
- `D1_ENVIRONMENT`: `local`, `preview` or `production`.
- `D1_DATABASE_ID` and the matching `D1_LOCAL_DATABASE_ID`,
  `D1_PREVIEW_DATABASE_ID` or `D1_PRODUCTION_DATABASE_ID`.
- `D1_PRODUCTION_DATABASE_ID` is required in every mode so a production database
  cannot accidentally be selected as a non-production target.

Local means a disposable non-production remote D1 target for this CLI. Tests and
the browser fixture use migrated Miniflare D1 directly through the same policy
service, without remote credentials or persistent local data.

1. Inspect the exact database/resource pair. This does not change policy:

   ```sh
   bun --cwd apps/server run mcp:policy inspect \
     --environment=production --resource=https://api.goosebumps.fm/mcp
   ```

2. Generate a plan with the observed version, the full intended scope set, a
   non-sensitive operator identity, reason and approval reference. Preserve
   existing scopes unless their removal was explicitly approved. For example,
   after approval to enable only editorial draft writes:

   ```sh
   bun --cwd apps/server run mcp:policy plan \
     --environment=production --resource=https://api.goosebumps.fm/mcp \
     --expected-version=1 --actor=operator \
     --reason='Enable owned editorial draft writes' \
     --approval='owner-approval-reference' \
     --scopes='posts:read offline_access drafts:write' > policy-plan.json
   ```

   Planning is read-only. Review the target, before/after scopes and approval.
   The plan's UUID is its retry identity. Do not regenerate it after an ambiguous
   apply result. The plan is not itself a credential or a substitute for approval.

3. Apply exactly that reviewed plan, with an explicit resource confirmation:

   ```sh
   bun --cwd apps/server run mcp:policy apply \
     --environment=production --resource=https://api.goosebumps.fm/mcp \
     --confirm-resource=https://api.goosebumps.fm/mcp --plan=policy-plan.json
   ```

   Save the JSON receipt with the operational evidence. Inspect again afterward.
   An identical retry returns the original receipt and the current policy state;
   it never reapplies an old policy after a subsequent rollout or rollback.
   Changed payloads with the same UUID conflict. Concurrent or stale plans fail
   closed rather than overwriting another operator's work.

The single guarded update changes only allowed scopes, policy version,
`updated_at` and the owned metadata history. It preserves other resource settings
and unrelated metadata, and never updates client registrations, consents or tokens.
It refuses missing, disabled, malformed or unrestricted (`allowed_scopes: null`)
policies rather than guessing their intended scope set.

## Audit and rollback

The existing resource metadata retains up to **50 receipts**, including operator,
approval reference, before/after scopes, versions and application time. No schema
migration or second operation ledger is needed. History is never silently pruned:
the command stops at 50 receipts or 256 KiB of encoded metadata. Archive/review and
an explicit retention change are required before further rollouts. This is
operational history, not a tamper-proof audit system against database operators.

To reverse the most recent change, generate a new reviewed plan:

```sh
bun --cwd apps/server run mcp:policy rollback-plan \
  --environment=production --resource=https://api.goosebumps.fm/mcp \
  --expected-version=2 --rollback-operation-id='<original-operation-uuid>' \
  --actor=operator --reason='Rollback draft-write rollout' \
  --approval='rollback-approval-reference' > rollback-plan.json
```

Apply it with the same explicit-confirmation command. Rollback increments the
version and records a new receipt. It refuses to reverse an older change over a
newer policy. Restoring a scope set after intervening changes requires a new
reviewed plan rather than replaying an old rollback.

Removing scopes makes affected tokens unusable on their next protected request.
It does not revoke their records; if those scopes are later re-enabled, an
otherwise-valid old grant can become usable again. Use the existing connection
revocation mechanism when permanent grant revocation is required. Read-only
grants are not expanded by activation or refresh.

## User upgrade journey

1. An operator enables only the approved scopes for the matching environment.
2. Configure the client to request the required scope union, for example
   `posts:read drafts:write offline_access` for the editorial draft tools.
3. Start fresh authorization from the client. Clear its cached OAuth login when
   needed; reconnecting with an old token is not a permission upgrade.
4. Review and approve the new consent screen. An old read-only client registration
   may need replacing if its registered scope ceiling excludes the new permission.
5. Check granted scopes in GBFM's Connections page and rediscover MCP tools. Do
   not test permissions by creating or publishing real content.

Protected-resource metadata reflects enabled tool scopes, not every implemented
scope. Requests for disabled scopes, including `drafts:write`, fail explicitly
instead of silently returning a smaller grant. Signed browser continuations show
requested, available and blocked permissions before offering consent. A policy
change during authorization is checked again by the server. Refresh cannot add
scopes. Local, preview and production audiences and grants remain separate.

No production policy activation is implied by committing this mechanism.
