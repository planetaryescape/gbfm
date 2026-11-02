# Personal access keys: specification progress

## Status: Implementation available for review

Implementation was subsequently authorized in the dedicated `feat/personal-access-keys` worktree. The migration was later applied to production, as verified below. No production issuance, publication, migration or deployment was performed in the web UI task. The design records below describe the intended acceptance bar; they are not proof that every planned test has run.

## Web management and production migration check, 2026-11-02

- Follow-up: replaced the sign-out/sign-in instruction with an accessible password-confirmation dialog. Confirmation renews the same account's session through the existing auth endpoint before issuance, preserving the key form and the backend's recent-session rule. Wrong passwords can be retried in place; cancellation creates no key. Account changes and impersonated sessions are rejected, and passwords stay outside app state and telemetry. Verification passed: `bun precommit`, 343 WWW unit tests, WWW production build, and eight Mobile Chrome/Safari journeys against disposable local data. No server contracts, database schema or production services were changed.
- Verified production migration history read-only: `0012_personal_access_keys.sql` was applied at `2026-11-01 19:46:14` UTC, its hash matches the local file, and `personal_access_keys` exists. No key records were read. The earlier operations note claiming that this migration was still pending was stale.
- Added `/dashboard/api-keys` under Settings, with scope and expiry selection, one-time secret display/copy/dismissal, paginated metadata, refresh, role-aware creation and confirmed revocation. Existing API permissions and session requirements are unchanged.
- Issuance runs in a scoped Foldkit Mount. Secrets are redacted at the HTTP adapter boundary and never enter app models, messages, SSR, browser storage or command arguments. Dismissal, unmount, page hide and historical-view pause clear the displayed secret.
- Verification: `bun precommit` passed; all 337 WWW unit tests passed; WWW production build passed; six Playwright journeys passed across Mobile Chrome and Mobile Safari against a disposable local D1 database. Desktop and narrow-screen layouts were also checked with agent-browser. No push or deployment was performed.

## Implementation, 2026-10-31

- Added application-owned D1 credentials, SHA-256 storage, one-time secret responses, expiry, revocation, owner/environment list filtering, recent non-impersonated session issuance, strict issuance fields, and atomic active-key/rate limits.
- Added a separate actor middleware and outer default-deny PAT route gate. Browser session behavior remains covered by the server regression suites.
- Enabled five post endpoints: owned manage list, owned edit read, preview, create, and update. Four scopes are available. Publishing and unpublishing require `posts:publish` plus a current editor/admin role. Admin keys remain owner-only.
- PAT creates require explicit lowercase hyphen-separated slugs. Conditional inserts and creator association share a D1 batch, so same-slug PAT retries fail without creating another post. Existing browser slug semantics are unchanged.
- Added guarded PAT updates and removed the private-media admin bypass for keys.
- Slice 3 is deferred: music resolution and image-upload scopes are not accepted and their routes reject PATs.
- Added migration `0012_personal_access_keys.sql`; applied only through disposable Miniflare D1 test fixtures.

### Contract differences and remaining evidence

- Several proposed denial variants use the common `KeyAccessDenied` response. Unknown/excluded PAT routes return 403 before authentication. Mixed credentials return 400. Strict issuance excess properties return 422; framework schema failures return 400.
- Rate-limit responses include the same exact remaining-window value in the JSON error and `Retry-After` header.
- Storage mechanics live in `PersonalAccessKeys`, rather than a separate repository service.
- Lifecycle events are logged without secrets. Captured Effect logs and OpenTelemetry spans cover issuance, authentication, listing and revocation and assert that neither credentials nor digests appear. Outer gate denials emit a fixed-shape security event without URLs or credentials. The full proposed security-event taxonomy remains deferred.
- The focused tests cover real password bootstrap, sign-out independence, issuance replay, owner/admin isolation, role changes, bans, revocation, expiry, environment separation, invalid stored scopes, strict inputs, stale/impersonated sessions, excluded routes, concurrent issuance and rate claims.
- The private-media admin fixture verifies that PATs cannot newly attach a foreign private original, while authorized existing attachments can be retained. The full matrix-generated exclusion suite and deterministic revocation/write interleavings remain outstanding. Do not treat the complete layer-6 test plan as satisfied.
- PAT updates now commit the guarded post row, label definitions/associations, and upload attachment bookkeeping in one D1 batch. Object-store publication remains a post-commit side effect of an authorized publication; it is not part of the D1 transaction. Session write semantics are unchanged.

See [Operations](OPERATIONS.md) for the implemented API workflow and deployment boundary.

### Implementation verification

| Check | Result |
| --- | --- |
| `bun precommit` | Passed, including formatting, lint and all workspace typechecks; existing Effect warnings remain |
| Server `test:unit` | 70 files, 678 tests passed |
| Server `test:d1` | 31 files, 148 tests passed, including twelve PAT tests |
| Core `test` | Historical count was incorrect; see the review-remediation verification record below |
| API `test` | 4 files, 30 tests passed |
| `git diff --check` | Passed |

That earlier D1 run included the guarded slug insert, exact-result ownership recheck, strict issuance decode, retained-row validation, and fixed-clock concurrent rate test. No production services were used by these tests.

### Review remediation, 2026-11-01

- PAT update slugs use the create format rule and an atomic collision predicate. Duplicate creates no longer rely on a creator foreign-key error. Collision tests verify that rejected renames do not mutate labels.
- Guarded writes advance `updatedAt` strictly, even if the retained timestamp is ahead of wall time. Markdown images join thumbnail/banner references in attachment bookkeeping, restricted to uploads owned by the key actor. Admin-key private-media denial and retained-attachment behavior have explicit regression coverage.
- Key labels reject Unicode controls, measure trimmed code points, and retain the 80-character bound. The role guard refines to branded `Role`; the core suite covers roles, scope dependencies and every draft/public transition.
- Issuance uses the middleware's session context. Role-loss races report access denial. The authentication clock is sampled after the primary read so a concurrent minute rollover is valid; an actually future stored minute still fails closed. Rate headers and bodies share the computed delay.
- Transport tests cover malformed credentials, duplicate credentials, the 1,024/1,025-character header boundary, and default-deny on public and unknown routes. Session-store failure returns a scrubbed 500 with a safe diagnostic, not an invalid-credential response.
- Captured lifecycle logs and exported spans exclude tokens and hashes. Direct D1 inserts verify expiry, rate-count and paired-window CHECK constraints.
- Verification: `bun precommit` passed; full server suite passed 678 unit and 166 D1 tests. The final PAT file then passed 22 tests, including the added session-store outage test. Core passed 16 tests across seven files; API passed 30 tests across four files. No production services were used.

### P1 review fix: atomic PAT update metadata

- Review identified a gap between the conditional post-row update and later label replacement. A session could publish the draft or remove key ownership in that gap, after which a key without publication scope could still overwrite tags.
- `apps/server/src/db/guarded-post-update.ts` now batches all PAT update D1 writes. Each dependent mutation checks the original post ID, `updatedAt`, draft state, and creator membership. The post update runs last so the original-state predicate remains valid throughout the batch. A stale guard performs no mutations and returns 409; any statement error rolls back the whole batch.
- Upload attachment bookkeeping had the same delayed-write shape and now shares that boundary. PAT creator changes remain forbidden. Draft-only keys do not schedule object-store publication; publication-capable operations copy only after their authorized batch commits.
- Four deterministic HTTP/D1 interleavings pause the real PAT database connection immediately before or after its write boundary. A separate normal-session HTTP request then publishes the post or transfers ownership and changes its tags/image. Before-batch races return 409 without mutation; after-batch races preserve the session's later values. The test adapter forwards every statement and batch to disposable Miniflare D1 without spies, module mocks, or fabricated database results.
- A real SQLite failure trigger on the final post update proves rollback of tags, new label definitions, and upload attachment state. The same fixture verifies successful empty-tag replacement after the trigger is removed. Duplicate tags and order are covered by the interleaving fixtures.
- Validation: focused PAT D1 suite, full D1 suite (148 tests), `bun precommit`, and `git diff --check` passed. The earlier 678-test unit result is retained as baseline evidence, not claimed as rerun for this fix.
- No commits, pushes, remote migrations, deployments, or production requests were made.

Workflow: `tech-spec-pro`, discovered at `~/dotfiles/agents/.agents/skills/tech-spec-pro/SKILL.md`. The requester explicitly waived feedback checkpoints and requested final documents. Layers are recorded as written and reviewed by the author, not user-confirmed. Interactive Plannotator review is skipped under that instruction.

| Layer | Record | State |
| --- | --- | --- |
| 0 | [Problem](00-problem.md) | Written and author-reviewed |
| 1 | [Shape](01-shape.md) | Written and author-reviewed |
| 2 | [Alternatives](02-alternatives.md) | Written and author-reviewed |
| 3 | [Contracts](03-contracts.md) | Written and author-reviewed |
| 4 | [Flows](04-flows.md) | Written and author-reviewed |
| 5 | [File map](05-file-map.md) | Written and author-reviewed |
| 6 | [Test plan](06-test-plan.md) | Written and author-reviewed |
| 7 | [Delivery slices](07-pr-slices.md) | Written and author-reviewed |
| Supporting evidence | [Authorization matrix](authorization-matrix.md) | Written; 114 protected endpoint IDs reconciled |

## Log

- 2026-10-30: Checked `prod` worktree first. Existing mobile edits and `bun.lock` changes are outside this task. Inspected baseline `c7773aebd24e4699b0d4909220db1d28280760cd`.
- 2026-10-30: Located workflow, read repository guidance, inspected authentication, post writes, media publication, endpoint declarations, and Better Auth 1.7.12. Started layered specification.
- 2026-10-30: Wrote layers 0 through 2; separated current handler behavior from proposed key policy and compared the exact matching API-key plugin release with an application-owned store.
- 2026-10-30: Wrote layer 3 and the endpoint matrix; defined actor, scopes, lifecycle, issuance retries, schema, transport, errors, and default-deny exclusions.
- 2026-10-30: Wrote layers 4 through 7; completed bootstrap/authoring/rotation flows, file ownership, real-seam test plan, and three bounded delivery slices.
- 2026-10-30: Author review tightened package dependency direction, reused the existing Crypto provider, clarified tags-only write guards, and checked the installed non-browser sign-in/sign-out source.
- 2026-10-30: Completed document checks and read-only repository checks below. Skipped interactive review as requested. No implementation, migration, credential lookup, production request, commit, or deployment performed.

## Verification record

| Check | Result and scope |
| --- | --- |
| Markdown structure, local links, trailing whitespace, prohibited em dashes | Passed across 10 Markdown files; 104 relative links resolved; code fences balanced |
| Protected endpoint inventory | Passed: all 114 `AuthMiddleware` endpoint IDs found in current API declarations appear in the matrix; raw/optional-auth exclusions also reviewed |
| `git diff --check` | Passed for tracked worktree differences; new spec whitespace checked separately |
| `bun run format:check` | Passed, 1,719 matched source/config files; root formatter does not include these Markdown docs |
| `bun run lint` | Exit 0 with existing-worktree Effect API/schema warnings; not a warning-free result, no fixes applied |
| `bun run typecheck` | Passed root and all workspace packages |
| `bun precommit` | Not run as written: it invokes repository-wide `format --write` and `lint --fix`, which could rewrite unrelated mobile work. Ran its read-only format/lint/typecheck counterparts instead |
| Runtime/auth/DB/crypto feature tests | Not run: this task adds only proposed documentation. Layer 6 defines future acceptance evidence |
| Plannotator/user checkpoints | Skipped at the requester's direction; no claim of user acceptance |

The verification table above records the earlier documentation-only phase. Implementation validation and handoff supersede its delivery statement. Work remains uncommitted for parent-agent review; the original worktree and its mobile edits were not touched.
