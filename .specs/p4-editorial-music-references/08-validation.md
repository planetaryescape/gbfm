# Validation and baseline diagnosis

Date: 2026-11-07. Isolated worktree `/home/user/workspace/gbfm-p4`, branch `design/p4-editorial-music-references`. Initial runtime baseline `aec2782a97bd91e2f030ef05095f76b54fcc79b1`; delivery base is P0 #547 at `78701b3e52d4a4b64a2d66482c1f2a7d982c7f5a` (documentation-only prerequisite). Runtime files and lockfile are unchanged. These checks cover existing behavior, not the proposed reference feature.

## Earlier failure: incomplete worktree dependencies

The first attempt temporarily linked only the original checkout's root `node_modules`. Bun's workspace-local package links under `apps/*/node_modules` were absent in the isolated worktree. `bun precommit` failed during `lint:fix`, before the typecheck script. Diagnostics included missing `@cloudflare/vitest-plugin/types`, unresolved/error-type constituents in Foldkit/observability, and Effect layer diagnostics in `show-page.test.ts`.

Those messages alone did not prove baseline code defects. The original checkout had the supposedly missing package at `apps/server/node_modules/@cloudflare/vitest-plugin`; the isolated worktree had no workspace installs. The temporary root link was removed, then the repository's existing setup instruction was used:

```sh
bun install --frozen-lockfile
bun precommit
```

Install exited 0: 1606 packages installed; the existing `prepare` command patched Effect TypeScript/oxlint as configured. Bun reported two blocked postinstalls; they were not approved or required for these passing checks. No tracked setup/config/lockfile edit was needed. The worktree now has its own installed workspace dependencies, not a root-only symlink.

`bun precommit` then exited **0**: formatter/linter completed and all workspace typechecks, including server and WWW, exited 0. Existing nonfatal Effect warnings remain. No tracked source changed between the failed and passing attempts. This is an environment/install failure resolved by the normal setup command, not an unresolved baseline code failure. The shipped setup script already runs the needed frozen install and prepare; no lifecycle repair is proposed.

## Existing real-seam control

From `apps/server`:

```sh
bunx vitest run --config vitest.d1.config.ts \
  src/http/editorial-mcp.d1.test.ts \
  src/db/guarded-post-update.d1.test.ts \
  src/services/post-music-resolution.d1.test.ts
```

Result: **3 files passed, 14 tests passed**, exit 0, duration 15.47 seconds. These use the existing migrated disposable D1 fixtures; the MCP suite composes persisted OAuth with the actual HTTP/MCP route. This confirms that relevant existing seams work in the correctly installed isolated worktree. It does not verify multiple-reference storage, UI, new scope behavior or atomicity that has not been implemented.

## Contract-schema smoke check

Evaluated the first TypeScript fence in `03-contracts.md` with the installed Effect 4.0.6 Schema API after transient Bun transpilation, without creating an application module. **9/9 discriminating cases passed**: non-first primary, empty collection, missing primary, nonmember primary, duplicate UUID with different case, same UUID in different entity types, 50 targets, 51 targets and an unknown field. This checks the proposed parser's shape/invariants only, not catalogue access, persistence or a public application seam. No scratch source/test file was retained.

## Delivery and limitations

- `git diff --check` passes; P4 changes only `.specs/p4-editorial-music-references/`.
- Document PR delivery is authorized. No runtime implementation, schema, migration, production data, policy, shared-file edit, merge or deployment.
- Design sketches are not application modules. Only the first parser sketch was transpiled/evaluated for the smoke check above; the complete service/API types are not implemented. Future E3 tests remain specified in `06-test-plan.md`, not marked passing here.
- No final implementation-tested SHA exists. The exact runtime baseline checked is named above; final document-head checks and independent review are recorded on the PR.
- P0 reconciliation uses the reviewed #547 contract at the delivery base and the P0 worker's clarification: scope/version rules match, but optional get_post reference enrichment needs a narrow owner design amendment and must not change legacy create/update receipts. Shared playlist visibility and whole-token eligibility gates are carried forward.
