# Bounded delivery slices

Status: **planned, not authorized or started**. The specification itself is the execution plan. There are no tickets, commits, migrations, or deployed changes attached to these slices.

## Slice 1: issue, use, and revoke a draft-authoring key

Deliver one end-to-end capability: a recent real session issues a limited key, the key creates/reads/previews/updates an owned draft, and revocation stops later use. Include lifecycle, secret handling, stage checks, active-key cap, per-key limits, actor middleware, transport gate/default deny, telemetry, management CSRF, schema and tests in this same vertical slice.

- Contracts: [D001/D002/D005](02-alternatives.md), management and actor/storage contracts in [03](03-contracts.md), draft/read rows of [matrix](authorization-matrix.md).
- Files: shared values/API schemas, management handlers, service/repository/schema/replay, gate/actor wiring, draft post policy, tests and tested bootstrap runbook in [05](05-file-map.md).
- Acceptance: real local HTTP sign-in -> issue -> draft create -> owner read -> update -> revoke -> 401; no fake session, no foreign data, no production writes, no secret in persisted metadata/logs. All excluded endpoint attempts are blocked. Expiry, stage clone, rate/issuance concurrency and lost issue response are proven.
- Interim boundary: issuance accepts only `posts:read`, `posts:create`, `posts:update`. Publish, image, and music scopes are not issuable yet. Public create/update via a key is denied, including default-public input. Existing session behavior stays intact.
- Approval boundary: implementation and schema changes need separate explicit authorization. Tests use throwaway D1; deployment/production issuance are not part of the merge criterion.

This is the largest slice because authentication cannot ship without revocation, exclusions, and leakage protection. Do not split it into a public issuance endpoint followed later by safety controls.

## Slice 2: safely publish and edit owned public posts

Depends on slice 1. Enable `posts:publish` issuance for current editor/admin and support public create/update/unpublish with the complete state table. This meets the original text-tweet outcome without music or uploads.

- Contracts: [D003/D004](02-alternatives.md), publish table, stable-slug retry behavior, actor-aware media boundary in [04](04-flows.md).
- Files: core key policy, post handlers/service, media-publication authority, API error declarations and integration tests.
- Acceptance: creator draft-only; editor/admin requires create/update plus publish as appropriate; omitted `draft`, metadata-only public changes, unpublish, foreign ownership and race cases cannot bypass publish scope. Session tests prove unchanged behavior. Duplicate slug/lost response has documented reconciliation rather than automatic duplicate creation.
- Deferred: music and image scopes still unissuable. Generic music/admin/email routes remain excluded.

## Slice 3: owned-post music and image attachments

Depends on slice 2. Enable `music:resolve` and `uploads:images:create` only with the supported endpoint policies and platform evidence.

- Contracts: resolver and image rows, post-provider recheck, private-media no-admin-bypass, presigned capability/expiry rules.
- Files: post music resolution, image presign handler, media-publication policy, relevant test extensions and operations runbook.
- Acceptance: draft -> resolve -> review -> publish through existing APIs; public resolution requires publish; revoked/demoted key cannot commit attachment after provider work; image upload is owner-scoped with verified size/MIME/expiry enforcement; key cannot access private preview, multipart, listing, or broad catalog management. No silent broadening to unblock a failing client.
- If signed PUT byte enforcement is not representable in local infrastructure, verify in an explicitly authorized disposable non-production environment before enabling image scope. Do not report the full slice complete with that claim unproven.

## Merge order and approval boundaries

Each slice is independently mergeable with existing session features working and only its tested scopes issuable. Later scopes must not be pre-granted in earlier slices. Registry/schema updates make intermediate capability explicit, with no hidden promise that an unknown scope will activate later.

Before any release, review the actual edge/IP protections for sign-in, issuance and invalid credential traffic; primary D1 behavior; secret capture settings; and proposed dependency/schema diffs. This is a bounded release review, not permission granted by this document. The root precommit gate and real-seam suites must pass for implementation. Record completed work with code/test evidence and actual delivery state, separate from this proposed specification.

No production rollout sequence is prescribed here. Schema application, deployment, production key issuance, and publishing the motivating tweet each require their own explicit authorization. Reverting a feature must not drop retained key metadata or pretend already published media has been withdrawn.
