# Future file ownership and delivery map

All entries below are **proposed implementation work, not reservations or permission to edit**. P4 edits only this spec folder. Actual E1/P1 exports and storage direction must be agreed before E3 claims files. P1 coordinates the dependent foundation/document stack; the corrected delivery rules in [07-pr-slices.md](07-pr-slices.md) supersede earlier merge-before-consumer guidance.

| File / module | Owner and future change |
| --- | --- |
| `packages/core/src/editorial-mcp.ts` | P1 owns principal/scope/error exports. Do not put catalogue domain types here merely because MCP uses them. |
| Proposed `packages/core/src/post-music-references.ts` | E3, after reservation: parsed ordered target value and membership/uniqueness rules, only if no E1/core source already owns it. Use existing ID/type contracts rather than duplicating them. |
| `packages/api/src/post.ts` | Shared post contract, serialized E1/E3: additive editable reference projection and optional patch field with required revision on reference changes; preserve existing route and micro semantics. |
| `apps/server/src/services/post.service.ts` | E1 then E3: coherent authorized post/reference snapshot, shared save operation, primary compatibility semantics and authored version inputs. No second backend. |
| `apps/server/src/services/post-music-resolution.ts` | E1/E3 reservation: preserve secondary references and version-check attachment writes after existing resolve; E3 must never use it for read-only URL lookup. |
| `apps/server/src/db/guarded-post-update.ts` | Shared serialized save owner: atomically save dependent reference state with primary/post update; keep PAT authorization. Browser's current branch is separate and must deliberately join an equivalent atomic path. |
| `apps/server/src/mcp/model.ts` | P1 integration/E1/E3 reservation: hash canonical reference state, never display; scope-filter additive read enrichment. |
| `apps/server/src/mcp/contracts.ts` | P1 integration: existing required inputs/results remain; agree additive authorized reference field. Domain value stays in core, not a transport-only duplicate. |
| `apps/server/src/mcp/drafts.ts`, `draft-store.ts` | E1/E3 with P1: operation discriminator, reference command, coherent CAS, same editorial receipt keys/window, transactional result and scoped replay; old text-only updates preserve associations. Reuse E1's actual store. |
| Proposed `apps/server/src/mcp/editorial-music/references.ts` | E3 thin `set_draft_music_references` projection, if E1 has created the folder. Delegate all authority/save rules to the shared service, not duplicate them. |
| `apps/server/src/mcp/server.ts`, `http/editorial-mcp.routes.ts` | P1 registry/transport owner: register selected E3 tool after gates, scope/role discovery, structured failure mapping and new bounded DTO. Existing four tools retain their accepted inputs/grants. |
| `apps/server/src/http/post.handlers.ts` | Shared E1/E3: parse/forward reference fields through existing actor/service boundary; no handler-only authorization. |
| `apps/www/src/page/creator/services.ts`, `model.ts`, `message.ts`, `update.ts`, `command.ts`, `view.ts` | Browser owner, serialized E3: local reference value/actions, scoped read, atomic save payload and late-response reconciliation; exact files narrowed after browser implementation inspection. Read `FOLDKIT.md` and installed Foldkit version before code. No WWW changes by P4. |
| `packages/rich-content/src/source.ts`, `schema.ts`; `services/rich-content-music.service.ts` | Read-only for association implementation unless a separate E1 embed change requires reservation. Existing syntax/snapshots are not reference storage. |
| `apps/server/src/db/post.schema.ts`, `exports.ts`, `apps/server/drizzle-d1/`, `apps/server/src/test/migrate-d1.ts` | Migration coordinator only after explicit schema approval. Pick relation or JSON, target-integrity and legacy-primary preservation; reserve actual migration filename/replay/export changes. Do not run production migration or drizzle push. |
| Catalogue target delete/merge paths | Catalogue/migration owners must prove restrictive target integrity or separately approved atomic preservation. E3 must not silently widen #316 or change canonical identity from this lane. |

## Existing test locations to extend

- `apps/server/src/http/editorial-mcp.d1.test.ts`: real persisted OAuth + MCP + browser/service composed scenario; legacy consent and body-size control.
- `apps/server/src/mcp/server.d1.test.ts`: command/replay/version/domain output with migrated D1.
- `apps/server/src/db/guarded-post-update.d1.test.ts`: transactional rollback/no-op on stale state through current save interface.
- `apps/server/src/http/editorial-drafts.d1.test.ts`: private edit read/projection and public exclusion.
- `apps/server/src/http/post-music-resolution.d1.test.ts` and `services/post-music-resolution.d1.test.ts`: existing resolve preserves secondary references and obeys the shared revision.
- `apps/www/src/page/creator/update.test.ts`, `publication.test.ts`, and `apps/www/e2e/editorial-drafts.spec.ts`: text/reference edits during save and explicit conflict reconciliation.
- A new domain test file is justified only for observable parsing/invariant behavior not already covered by the public service tests. Prefer extending existing tests. No mock-interaction assertions or tests of private helper order.

## Integration order

P0 D1–D6 approved design → P1 implementation approval, named owner and real composed fixture → R1 public catalogue contracts and E1 shared save → approved P4 + separate schema approval/coordinator → E3.

The P4 documentation PR depends only on P0 #547; no runtime prerequisite is needed to review the design. P1 coordinates dependent implementation layers. Every PR stays unmerged for Guide Fari's overview review, with no auto-merge; each requires its own `anthropic/claude-opus-5-5` thread loading `code-review` and posting actionable inline findings on the actual PR. Address findings/checks before review handoff. E1/E3/C1/C4 serialize post/version/publication files; schema and registry stay with their named coordinators. Final checks run at the cumulative stack head, not only the isolated E3 head. This map grants no runtime, schema, merge, deploy or data-change authority.
