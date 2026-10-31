# Personal access keys: specification progress

## Status: Implementation available for review

Implementation was subsequently authorized in the dedicated `feat/personal-access-keys` worktree. Production migrations, issuance, publication, and deployment remain unauthorized. The design records below describe the intended acceptance bar; they are not proof that every planned test has run.

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
- Rate-limit responses include an exact remaining-window value in the JSON error and a conservative 60-second `Retry-After` header.
- Storage mechanics live in `PersonalAccessKeys`, rather than a separate repository service.
- Lifecycle events are logged without secrets. The full planned security-event taxonomy and captured exporter/log secret-leak tests have not been implemented.
- The focused tests cover real password bootstrap, sign-out independence, issuance replay, owner/admin isolation, role changes, bans, revocation, expiry, environment separation, invalid stored scopes, strict inputs, stale/impersonated sessions, excluded routes, concurrent issuance and rate claims.
- The full matrix-generated exclusion suite, deterministic revocation/write interleavings, and private-media admin fixture remain outstanding. Do not treat the complete layer-6 test plan as satisfied.
- PAT updates now commit the guarded post row, label definitions/associations, and upload attachment bookkeeping in one D1 batch. Object-store publication remains a post-commit side effect of an authorized publication; it is not part of the D1 transaction. Session write semantics are unchanged.

See [Operations](OPERATIONS.md) for the implemented API workflow and deployment boundary.

### Implementation verification

| Check | Result |
| --- | --- |
| `bun precommit` | Passed, including formatting, lint and all workspace typechecks; existing Effect warnings remain |
| Server `test:unit` | 70 files, 678 tests passed |
| Server `test:d1` | 31 files, 148 tests passed, including twelve PAT tests |
| Core `test` | 7 files, 30 tests passed |
| API `test` | 4 files, 30 tests passed |
| `git diff --check` | Passed |

The final D1 run includes the guarded slug insert, exact-result ownership recheck, strict issuance decode, retained-row validation, and fixed-clock concurrent rate test. No production services were used by these tests.

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
