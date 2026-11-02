# Personal access keys: specification progress

## Status: Complete, proposed design

Design only. This folder does not authorize implementation, migrations, key issuance, publication, or deployment.

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

Delivery: local uncommitted documentation under `docs/specs/personal-access-keys/` only. Existing mobile and lockfile edits remain outside this work. Specification completion grants no implementation or production authority.
